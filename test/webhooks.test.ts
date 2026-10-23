import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Kori, KoriSignatureVerificationError, type WebhookEvent } from '../src/index.js';

const kori = new Kori({ apiKey: 'k', apiSecret: 's' });
const secret = 'whsec_test_9f2b7c1e4a8d05f3';
const payload = {
  event: 'payment_received',
  data: { title: 'Payment received', reference: 'PAY_42_1', amount: 5000, payment_link_id: null, payment_session_id: null, client_reference_id: null },
  timestamp: '2026-10-06T12:00:00.000Z',
  merchant_id: 'mch_1f2e3d4c5b6a79880a1b2c3d',
};
const body = JSON.stringify(payload);
// Exactly what api-kori-pay/shared/utils/webhookDelivery.js does.
const signature = createHmac('sha256', secret).update(body).digest('hex');

describe('webhooks.verify', () => {
  it('accepts a correctly signed string or Buffer body and returns the typed event', () => {
    const event = kori.webhooks.verify(body, signature, secret);
    expect(event).toEqual(payload);
    if (event.event === 'payment_received') expect(event.data.reference).toBe('PAY_42_1');
    expect(kori.webhooks.verify(Buffer.from(body), signature.toUpperCase(), secret)).toEqual(payload);
    expect(kori.webhooks.verify(new TextEncoder().encode(body), [signature], secret)).toEqual(payload);
  });

  it('rejects a tampered body, a wrong secret, and malformed or missing signatures', () => {
    const tampered = body.replace('5000', '500000');
    for (const [b, sig, sec] of [
      [tampered, signature, secret],
      [body, signature, 'other-secret'],
      [body, signature.slice(0, 10), secret],
      [body, 'zz' + signature.slice(2), secret],
      [body, undefined, secret],
      [body, '', secret],
    ] as const) {
      expect(() => kori.webhooks.verify(b, sig, sec)).toThrow(KoriSignatureVerificationError);
    }
  });

  it('refuses a parsed body with a pointer to the fix', () => {
    expect(() => kori.webhooks.verify(payload as never, signature, secret)).toThrow(/express\.raw/);
  });

  it('signs like the server, for testing handlers', () => {
    expect(kori.webhooks.sign(body, secret)).toBe(signature);
  });
});

// End to end against the server's real delivery code, when api-kori-pay is checked out
// next to this repo: fireWebhooks POSTs to a local server, and verify() must accept it.
const deliveryModule = fileURLToPath(new URL('../../api-kori-pay/shared/utils/webhookDelivery.js', import.meta.url));

describe.skipIf(!existsSync(deliveryModule))('against api-kori-pay webhookDelivery.js', () => {
  it('verifies a delivery made by fireWebhooks', async () => {
    const received = new Promise<{ raw: Buffer; headers: Record<string, unknown> }>((resolve) => {
      const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          res.end('ok');
          server.close();
          resolve({ raw: Buffer.concat(chunks), headers: req.headers });
        });
      });
      server.listen(0, '127.0.0.1', async () => {
        const { port } = server.address() as { port: number };
        const { fireWebhooks } = createRequire(import.meta.url)(deliveryModule);
        // A stand-in for the DB: one webhook row subscribed to payout_completed.
        const query = async (sql: string) =>
          sql.trim().startsWith('SELECT')
            ? [{ id: 1, url: `http://127.0.0.1:${port}/hook`, secret, events: 'payout_completed', failure_count: 0, merchant_uid: 'mch_e2e' }]
            : [];
        await fireWebhooks(query, 42, 'payout_completed', { payout_id: 310, reference: 'PO_1', amount: 25000 });
      });
    });

    const { raw, headers } = await received;
    const event: WebhookEvent = kori.webhooks.verify(raw, headers['x-kori-signature'] as string, secret);
    expect(headers['x-kori-event']).toBe('payout_completed');
    expect(event.event).toBe('payout_completed');
    expect(event.merchant_id).toBe('mch_e2e');
    if (event.event === 'payout_completed') expect(event.data.payout_id).toBe(310);
  });
});
