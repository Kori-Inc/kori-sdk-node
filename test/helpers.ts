import { Kori, type KoriOptions } from '../src/index.js';

export interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;
type Handler = (call: Call, n: number) => Reply | Promise<Reply>;

const AUTH_OK = {
  success: true,
  data: {
    token: 'tok_1',
    token_type: 'Bearer',
    scopes: ['pay', 'payout'],
    expires_in: 86400,
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
    merchant: { id: 'mch_abc', business_name: 'Test' },
  },
};

/**
 * A Kori client over a scripted fetch. `/auth` answers with a token unless the handler
 * handles it; every call is recorded in `calls` (auth included) in order.
 */
export function mockKori(handler: Handler, options: KoriOptions = {}) {
  const calls: Call[] = [];
  let tokenCount = 0;
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url: new URL(String(input)),
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    let reply = await handler(call, calls.filter((c) => c.url.pathname === call.url.pathname).length);
    if (reply === undefined && call.url.pathname === '/merchant/api/auth') {
      tokenCount++;
      reply = { body: { ...AUTH_OK, data: { ...AUTH_OK.data, token: `tok_${tokenCount}` } } };
    }
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error(`unhandled ${call.method} ${call.url.pathname}`);
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  }) as typeof globalThis.fetch;

  const kori = new Kori({ apiKey: 'mk_test', apiSecret: 'ms_test', fetch, maxRetries: 2, ...options });
  return { kori, calls, apiCalls: () => calls.filter((c) => c.url.pathname !== '/merchant/api/auth') };
}

export function connRefused(): Error {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
}
