import { describe, expect, it, vi } from 'vitest';
import {
  Kori,
  KoriAuthenticationError,
  KoriConflictError,
  KoriConnectionError,
  KoriPermissionError,
  KoriRateLimitError,
  KoriServerError,
  KoriValidationError,
} from '../src/index.js';
import { connRefused, mockKori } from './helpers.js';

// Backoff sleeps are real timers; keep them out of the test runtime.
vi.spyOn(Math, 'random').mockReturnValue(0);

describe('authentication', () => {
  it('exchanges key + secret once, then sends the Bearer token', async () => {
    const { kori, calls } = mockKori((c) =>
      c.url.pathname === '/merchant/api/balance' ? { body: { success: true, data: { balance: 100 } } } : undefined as never,
    { scopes: ['balance'], tokenTtlHours: 6 });

    await Promise.all([kori.payments.balance(), kori.payments.balance(), kori.payments.balance()]);

    const auth = calls.filter((c) => c.url.pathname === '/merchant/api/auth');
    expect(auth).toHaveLength(1);
    expect(auth[0]!.headers.get('x-api-key')).toBe('mk_test');
    expect(auth[0]!.headers.get('x-api-secret')).toBe('ms_test');
    expect(auth[0]!.body).toEqual({ scopes: ['balance'], expires_in_hours: 6 });
    const api = calls.filter((c) => c.url.pathname !== '/merchant/api/auth');
    expect(api.every((c) => c.headers.get('authorization') === 'Bearer tok_1')).toBe(true);
    expect(api[0]!.headers.get('x-api-secret')).toBeNull();
  });

  it('gets a new token and replays once when the API answers 401', async () => {
    const { kori, calls } = mockKori((c, n) => {
      if (c.url.pathname !== '/merchant/api/balance') return undefined as never;
      return n === 1
        ? { status: 401, body: { success: false, message: 'Token is invalid or has expired' } }
        : { body: { success: true, data: { balance: 5 } } };
    });

    await expect(kori.payments.balance()).resolves.toEqual({ balance: 5 });
    const balanceCalls = calls.filter((c) => c.url.pathname === '/merchant/api/balance');
    expect(balanceCalls.map((c) => c.headers.get('authorization'))).toEqual(['Bearer tok_1', 'Bearer tok_2']);
  });

  it('does not loop when the new token is refused too', async () => {
    const { kori, apiCalls } = mockKori((c) =>
      c.url.pathname === '/merchant/api/balance' ? { status: 401, body: { success: false, message: 'nope' } } : undefined as never,
    );
    await expect(kori.payments.balance()).rejects.toBeInstanceOf(KoriAuthenticationError);
    expect(apiCalls()).toHaveLength(2);
  });

  it('surfaces bad credentials from /auth without retrying', async () => {
    const { kori, calls } = mockKori(() => ({ status: 401, body: { success: false, message: 'Invalid API secret' } }));
    await expect(kori.authenticate()).rejects.toThrow('Invalid API secret');
    expect(calls).toHaveLength(1);
  });

  it('fails clearly without credentials', async () => {
    const kori = new Kori({ fetch: (async () => new Response('{}')) as typeof fetch });
    await expect(kori.payments.balance()).rejects.toThrow(/API key and secret are required/);
  });

  it('does not authenticate the public payment-status call', async () => {
    const { kori, calls } = mockKori(() => ({ body: { message: 'SUCCESS', state: 'success', status: true } }));
    await expect(kori.payments.status('PAY_1/x')).resolves.toMatchObject({ state: 'success' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe('/merchant/api/payment/status/PAY_1%2Fx');
    expect(calls[0]!.headers.get('authorization')).toBeNull();
  });
});

describe('environments', () => {
  it('defaults to the sandbox', () => {
    expect(new Kori({ apiKey: 'k', apiSecret: 's' }).baseUrl).toBe('https://sandbox.kori.ml');
    expect(new Kori({ apiKey: 'k', apiSecret: 's', environment: 'live' }).baseUrl).toBe('https://gateway.kori.ml');
    expect(() => new Kori({ environment: 'prod' as never })).toThrow(/Unknown Kori environment/);
  });
});

describe('errors', () => {
  const fail = (status: number, body: object, headers?: Record<string, string>) =>
    mockKori((c) => (c.url.pathname === '/merchant/api/auth' ? undefined as never : { status, body, headers }), { maxRetries: 0 }).kori;

  it('maps 403 with the scopes the endpoint wants', async () => {
    const err = await fail(403, { success: false, message: 'Insufficient permissions. Required scope: payout', required_scopes: ['payout'] })
      .payouts.list().then(() => null, (e: any) => e);
    expect(err).toBeInstanceOf(KoriPermissionError);
    expect(err.requiredScopes).toEqual(['payout']);
    expect(err.status).toBe(403);
  });

  it('maps a duplicate reference to KoriConflictError with the existing transaction', async () => {
    const err = await fail(409, {
      success: false,
      message: 'Transaction with this reference already exists',
      request_id: 'req-1',
      existing_transaction: { id: 7, status: 'pending' },
    }).payments.collect({ amount: 500, payment_method: 'OrangeMoney', customer_phone: '+22370000000', reference: 'order-1' })
      .then(() => null, (e: any) => e);
    expect(err).toBeInstanceOf(KoriConflictError);
    expect(err.existingTransaction).toEqual({ id: 7, status: 'pending' });
    expect(err.requestId).toBe('req-1');
  });

  it('maps 400 and keeps the body', async () => {
    const err = await fail(400, { success: false, message: 'Amount must be at least 100 XOF' }).payments
      .collect({ amount: 1, payment_method: 'Wave', customer_phone: '1' }).then(() => null, (e: any) => e);
    expect(err).toBeInstanceOf(KoriValidationError);
    expect(err.message).toBe('Amount must be at least 100 XOF');
    expect(err.body).toMatchObject({ success: false });
  });

  it('treats success:false on a 2xx as an error', async () => {
    const { kori } = mockKori((c) => (c.url.pathname === '/merchant/api/auth' ? undefined as never : { body: { success: false, message: 'odd' } }));
    await expect(kori.settings.retrieve()).rejects.toThrow('odd');
  });

  it('rejects non-numeric ids before sending anything', () => {
    const { kori } = mockKori(() => ({ body: {} }));
    expect(() => kori.payouts.retrieve('../balance' as never)).toThrow(/numeric id/);
  });
});

describe('retries', () => {
  const ok = { body: { success: true, data: { id: 1 } } };

  it('retries a GET on 503', async () => {
    const { kori, apiCalls } = mockKori((c, n) =>
      c.url.pathname === '/merchant/api/auth' ? undefined as never : n < 3 ? { status: 503, body: { message: 'down' } } : ok,
    );
    await expect(kori.payouts.retrieve(1)).resolves.toEqual({ id: 1 });
    expect(apiCalls()).toHaveLength(3);
  });

  it('gives up after maxRetries', async () => {
    const { kori, apiCalls } = mockKori((c) =>
      c.url.pathname === '/merchant/api/auth' ? undefined as never : { status: 502, body: { message: 'bad gateway' } },
    { maxRetries: 1 });
    await expect(kori.payouts.retrieve(1)).rejects.toBeInstanceOf(KoriServerError);
    expect(apiCalls()).toHaveLength(2);
  });

  it('never replays a payment POST after a 5xx: it may have prompted the customer', async () => {
    const { kori, apiCalls } = mockKori((c) =>
      c.url.pathname === '/merchant/api/auth' ? undefined as never : { status: 500, body: { message: 'provider timeout' } },
    );
    await expect(
      kori.payments.collect({ amount: 500, payment_method: 'OrangeMoney', customer_phone: '+22370000000' }),
    ).rejects.toBeInstanceOf(KoriServerError);
    expect(apiCalls()).toHaveLength(1);
  });

  it('never replays a payout POST after a timeout', async () => {
    const { kori, apiCalls } = mockKori((c) =>
      c.url.pathname === '/merchant/api/auth' ? undefined as never : Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );
    await expect(kori.payouts.create({ amount: 5000, payment_method: 'Wave', destination_phone: '1' })).rejects.toBeInstanceOf(
      KoriConnectionError,
    );
    expect(apiCalls()).toHaveLength(1);
  });

  it('does retry a POST when the connection was refused, since nothing was sent', async () => {
    const { kori, apiCalls } = mockKori((c, n) =>
      c.url.pathname === '/merchant/api/auth' ? undefined as never : n === 1 ? connRefused() : ok,
    );
    await expect(kori.payouts.create({ amount: 5000, payment_method: 'Wave', destination_phone: '1' })).resolves.toEqual({ id: 1 });
    expect(apiCalls()).toHaveLength(2);
  });

  it('waits out a short 429 and retries, even a POST', async () => {
    const { kori, apiCalls } = mockKori((c, n) =>
      c.url.pathname === '/merchant/api/auth' ? undefined as never
        : n === 1 ? { status: 429, body: { success: false, message: 'slow down' }, headers: { 'retry-after': '0' } } : ok,
    );
    await expect(kori.beneficiaries.create({ name: 'A', account: '1', payment_method: 'Wave' })).resolves.toEqual({ id: 1 });
    expect(apiCalls()).toHaveLength(2);
  });

  it('surfaces a long 429 instead of sleeping through it', async () => {
    const { kori } = mockKori(() => ({ status: 429, body: { success: false, message: 'Too many auth attempts' }, headers: { 'retry-after': '900' } }));
    const err = await kori.authenticate().then(() => null, (e: any) => e);
    expect(err).toBeInstanceOf(KoriRateLimitError);
    expect(err.retryAfter).toBe(900);
  });

  it('times out a hung request', async () => {
    const kori = new Kori({
      apiKey: 'k', apiSecret: 's', timeoutMs: 20, maxRetries: 0,
      fetch: ((_u: string, init: RequestInit) => new Promise((_r, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch,
    });
    await expect(kori.authenticate()).rejects.toThrow(/timed out after 20ms/);
  });

  it('passes the caller abort reason through untouched', async () => {
    const controller = new AbortController();
    const kori = new Kori({
      apiKey: 'k', apiSecret: 's',
      fetch: ((_u: string, init: RequestInit) => new Promise((_r, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch,
    });
    const p = kori.payments.status('X', { signal: controller.signal });
    controller.abort(new Error('user cancelled'));
    await expect(p).rejects.toThrow('user cancelled');
  });
});

describe('pagination', () => {
  const page = (items: number[], offset: number, total: number) => ({
    body: {
      success: true,
      data: {
        payouts: items.map((id) => ({ id })),
        pagination: { total, limit: 2, offset, has_more: offset + items.length < total },
      },
    },
  });

  it('awaits to the first page and iterates every item across pages', async () => {
    const { kori, apiCalls } = mockKori((c) => {
      if (c.url.pathname === '/merchant/api/auth') return undefined as never;
      const offset = Number(c.url.searchParams.get('offset') ?? 0);
      return offset === 0 ? page([1, 2], 0, 5) : offset === 2 ? page([3, 4], 2, 5) : page([5], 4, 5);
    });

    const first = await kori.payouts.list({ limit: 2, status: 'pending' });
    expect(first.data.map((p) => p.id)).toEqual([1, 2]);
    expect(first.hasMore).toBe(true);

    const ids: number[] = [];
    for await (const p of kori.payouts.list({ limit: 2, status: 'pending' })) ids.push(p.id!);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(apiCalls().every((c) => c.url.searchParams.get('status') === 'pending' && c.url.searchParams.get('limit') === '2')).toBe(true);
  });

  it('reads each resource from its own key', async () => {
    const { kori } = mockKori((c) => {
      if (c.url.pathname === '/merchant/api/auth') return undefined as never;
      const key = { '/merchant/api/beneficiaries': 'beneficiaries', '/merchant/api/payment-links': 'payment_links',
        '/merchant/api/bulk/batches': 'batches', '/merchant/api/bulk/batches/9/recipients': 'recipients',
        '/merchant/api/transactions': 'transactions' }[c.url.pathname]!;
      return { body: { success: true, data: { [key]: [{ id: 1 }], pagination: { has_more: false } } } };
    });
    for (const p of [kori.beneficiaries.list(), kori.paymentLinks.list(), kori.bulkBatches.list(),
      kori.bulkBatches.listRecipients(9), kori.transactions.list()]) {
      expect((await p).data).toEqual([{ id: 1 }]);
    }
  });

  it('unwraps the unpaginated team and webhook lists', async () => {
    const { kori } = mockKori((c) =>
      c.url.pathname === '/merchant/api/team' ? { body: { success: true, data: { team_members: [{ id: 3 }] } } }
        : c.url.pathname === '/merchant/api/webhooks' ? { body: { success: true, data: { webhooks: [{ id: 4 }] } } }
        : undefined as never,
    );
    expect(await kori.team.list()).toEqual([{ id: 3 }]);
    expect(await kori.webhookEndpoints.list()).toEqual([{ id: 4 }]);
  });
});

describe('payments.waitForResult', () => {
  it('polls until the payment leaves pending', async () => {
    const states = ['pending', 'pending', 'success'];
    const { kori, calls } = mockKori(() => ({ body: { state: states.shift(), status: false } }));
    await expect(kori.payments.waitForResult('PAY_1', { intervalMs: 1 })).resolves.toMatchObject({ state: 'success' });
    expect(calls).toHaveLength(3);
  });

  it('returns pending once the timeout passes', async () => {
    const { kori } = mockKori(() => ({ body: { state: 'pending', status: false } }));
    await expect(kori.payments.waitForResult('PAY_1', { intervalMs: 5, timeoutMs: 12 })).resolves.toMatchObject({ state: 'pending' });
  });
});

describe('package', () => {
  it('keeps VERSION in step with package.json', async () => {
    const { VERSION } = await import('../src/index.js');
    const pkg = await import('../package.json', { with: { type: 'json' } });
    expect(VERSION).toBe(pkg.default.version);
  });
});
