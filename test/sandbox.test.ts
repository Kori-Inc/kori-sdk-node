// Contract tests against the real sandbox (simulated payments, no money moves).
// Skipped unless KORI_SANDBOX_API_KEY and KORI_SANDBOX_API_SECRET are set:
//   KORI_SANDBOX_API_KEY=mk_… KORI_SANDBOX_API_SECRET=ms_… npm test
// Point KORI_SANDBOX_URL at a local merchant service to test a branch before deploying.
import { describe, expect, it } from 'vitest';
import { Kori, KoriPermissionError } from '../src/index.js';

const apiKey = process.env.KORI_SANDBOX_API_KEY;
const apiSecret = process.env.KORI_SANDBOX_API_SECRET;
const baseUrl = process.env.KORI_SANDBOX_URL;

// Outcomes the sandbox simulates per phone number (shared/services/SimulatedTouch.js).
const SUCCEEDS = '+22370000000';
const FAILS = '+22370000001';

describe.skipIf(!apiKey || !apiSecret)('sandbox contract', () => {
  const kori = new Kori({
    apiKey, apiSecret, environment: 'sandbox', ...(baseUrl ? { baseUrl } : {}),
    scopes: ['pay', 'balance', 'payment_links', 'webhooks'],
  });

  it('authenticates with the requested scopes', async () => {
    const token = await kori.authenticate();
    expect(token.scopes).toEqual(expect.arrayContaining(['pay', 'balance']));
    expect(token.merchant?.id).toMatch(/^mch_/);
  });

  it('reads the balance', async () => {
    const balance = await kori.payments.balance();
    expect(typeof balance.balance).toBe('number');
    expect(balance.currency).toBe('XOF');
  });

  it('collects a payment that settles to success, and one that fails', async () => {
    const ok = await kori.payments.collect({
      amount: 500, payment_method: 'OrangeMoney', customer_phone: SUCCEEDS, reference: `sdk_ok_${Date.now()}`,
    });
    expect(ok.status).toBe('pending');
    const bad = await kori.payments.collect({
      amount: 500, payment_method: 'OrangeMoney', customer_phone: FAILS, reference: `sdk_fail_${Date.now()}`,
    });

    await expect(kori.payments.waitForResult(ok.reference!, { timeoutMs: 30_000, intervalMs: 2_000 }))
      .resolves.toMatchObject({ state: 'success' });
    await expect(kori.payments.waitForResult(bad.reference!, { timeoutMs: 30_000, intervalMs: 2_000 }))
      .resolves.toMatchObject({ state: 'failed' });

    const tx = await kori.transactions.retrieve(ok.transaction_id!);
    expect(tx.reference).toBe(ok.reference);
  }, 70_000);

  it('pages through transactions', async () => {
    const page = await kori.transactions.list({ limit: 2 });
    expect(Array.isArray(page.data)).toBe(true);
    expect(page.pagination.limit).toBe(2);
  });

  it('creates a payment link and a checkout session on it', async () => {
    const link = await kori.paymentLinks.create({ title: `SDK test ${Date.now()}`, amount: 1500 });
    const session = await kori.paymentLinks.createSession(link.id!, { client_reference_id: 'sdk_order_1' });
    expect(session.url).toMatch(/\/s\/ps_/);
    expect((await kori.paymentSessions.retrieve(session.id!)).status).toBe('open');
    await kori.paymentSessions.cancel(session.id!);
    await kori.paymentLinks.delete(link.id!);
  });

  it('refuses an endpoint outside the token scopes with the scope it needs', async () => {
    const err = await kori.payouts.list().then(() => null, (e: any) => e);
    expect(err).toBeInstanceOf(KoriPermissionError);
    expect(err.requiredScopes).toContain('payout');
  });
});
