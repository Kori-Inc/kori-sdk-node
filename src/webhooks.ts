import { createHmac, timingSafeEqual } from 'node:crypto';
import { KoriSignatureVerificationError } from './errors.js';

/** The header Kori signs deliveries with: hex HMAC-SHA256 of the raw body. */
export const SIGNATURE_HEADER = 'x-kori-signature';

interface Base<E extends string, D> {
  event: E;
  data: D & {
    /** Dashboard wording, for logs. Don't branch on it. */
    title?: string;
    message?: string;
  };
  /** ISO 8601 time of the event. */
  timestamp: string;
  /** Your public merchant id (`mch_…`). Absent on `test` deliveries. */
  merchant_id?: string;
}

interface PaymentData {
  reference: string;
  amount: number;
  payment_link_id: number | null;
  payment_session_id: number | null;
  client_reference_id: string | null;
}

interface PayoutData {
  payout_id: number;
  reference: string;
  amount: number;
}

/** A settled collection made with `payments.collect`. */
export type PaymentReceivedEvent = Base<'payment_received', PaymentData>;
/** A settled collection made through a payment link or checkout session. */
export type PaymentLinkUsedEvent = Base<'payment_link_used', PaymentData>;
export type PayoutCompletedEvent = Base<'payout_completed', PayoutData>;
/** The payout failed and its amount was refunded to your balance. */
export type PayoutFailedEvent = Base<'payout_failed', PayoutData>;
export type BulkPayDoneEvent = Base<
  'bulk_pay_done',
  { batch_id: number; success_count: number; failed_count: number; refunded: number }
>;
export type ApiKeyCreatedEvent = Base<'api_key_created', { action: string; scopes?: string[] }>;
export type SecurityAlertEvent = Base<
  'security_alert',
  { action: string; user_id?: number; sessions_revoked?: number }
>;
/** Sent by `webhookEndpoints.sendTest()`. */
export type TestEvent = Base<'test', Record<string, never>>;
/** Reserved: accepted at registration, not emitted yet. */
export type TeamLoginEvent = Base<'team_login', Record<string, unknown>>;

export type WebhookEvent =
  | PaymentReceivedEvent
  | PaymentLinkUsedEvent
  | PayoutCompletedEvent
  | PayoutFailedEvent
  | BulkPayDoneEvent
  | ApiKeyCreatedEvent
  | SecurityAlertEvent
  | TeamLoginEvent
  | TestEvent;

type RawBody = string | Uint8Array;

export class Webhooks {
  /**
   * Check a delivery's `X-Kori-Signature` and return the parsed event. Throws
   * `KoriSignatureVerificationError` if it doesn't match: reject the request (400).
   *
   * Pass the body exactly as received (a string or Buffer), before any JSON parsing:
   * re-serializing a parsed object changes the bytes and the signature won't match.
   *
   *   app.post('/webhooks/kori', express.raw({ type: 'application/json' }), (req, res) => {
   *     const event = kori.webhooks.verify(req.body, req.get('x-kori-signature'), secret);
   *     …
   *   });
   */
  verify(rawBody: RawBody, signature: string | string[] | null | undefined, secret: string): WebhookEvent {
    if (typeof rawBody !== 'string' && !(rawBody instanceof Uint8Array)) {
      throw new TypeError(
        'webhooks.verify needs the raw request body (string or Buffer), not a parsed object. ' +
          "With Express, use express.raw({ type: 'application/json' }) on the webhook route.",
      );
    }
    if (!secret) throw new TypeError('webhooks.verify needs your webhook signing secret');

    const header = Array.isArray(signature) ? signature[0] : signature;
    if (!header) throw new KoriSignatureVerificationError('Missing X-Kori-Signature header');

    if (!this.isValidSignature(rawBody, header, secret)) {
      throw new KoriSignatureVerificationError('Webhook signature does not match the body');
    }

    const text = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
    try {
      return JSON.parse(text) as WebhookEvent;
    } catch (cause) {
      throw new KoriSignatureVerificationError('Webhook body is not valid JSON', { cause });
    }
  }

  /** The boolean form of `verify`, without parsing. Constant-time. */
  isValidSignature(rawBody: RawBody, signature: string, secret: string): boolean {
    const expected = this.sign(rawBody, secret);
    const given = signature.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(given) || given.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
  }

  /** The signature Kori would send for this body. Handy for testing your handler. */
  sign(rawBody: RawBody, secret: string): string {
    return createHmac('sha256', secret).update(rawBody).digest('hex');
  }
}
