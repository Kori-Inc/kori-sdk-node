import type { RequestOptions } from '../http.js';
import type { Balance, DepositParams, PaymentStatus, PayParams, TransactionResult } from '../types.js';
import { API, Resource } from './base.js';

export interface WaitOptions extends RequestOptions {
  /** Give up after this long, in milliseconds (default 120 000). */
  timeoutMs?: number;
  /** Delay between checks, in milliseconds (default 3 000). */
  intervalMs?: number;
}

export class Payments extends Resource {
  /**
   * Prompt a customer to pay (USSD push, or a `payment_url` for Wave). Resolves with
   * `status: "pending"`: the customer has only been asked. Treat the order as paid only
   * on the `payment_received` webhook or a `success` from `waitForResult()`.
   *
   * Pass your own `reference` (e.g. your order id): it is the idempotency key, and the
   * only way to look the payment up if this call times out. This call is never retried
   * after an ambiguous failure, since that could prompt the customer twice.
   */
  collect(params: PayParams, options?: RequestOptions): Promise<TransactionResult> {
    return this.data({ ...options, method: 'POST', path: `${API}/pay`, body: params });
  }

  /** Send money from your balance to a customer's wallet. Settles synchronously. */
  deposit(params: DepositParams, options?: RequestOptions): Promise<TransactionResult> {
    return this.data({ ...options, method: 'POST', path: `${API}/deposit`, body: params });
  }

  balance(options?: RequestOptions): Promise<Balance> {
    return this.data({ ...options, method: 'GET', path: `${API}/balance` });
  }

  /**
   * Ask the operator for a collection's state, by its `reference`. Authoritative while
   * a payment is open; it also settles the transaction once the operator confirms.
   */
  status(reference: string, options?: RequestOptions): Promise<PaymentStatus> {
    return this.http.request({
      ...options,
      method: 'GET',
      path: `${API}/payment/status/${encodeURIComponent(reference)}`,
      auth: 'none',
    });
  }

  /**
   * Poll `status()` until the payment leaves `pending` or `timeoutMs` passes, and return
   * the last state. A fallback for when a customer is waiting on screen; prefer webhooks.
   * A `pending` result after the timeout is not a failure: the payment may still complete.
   */
  async waitForResult(reference: string, options: WaitOptions = {}): Promise<PaymentStatus> {
    const { timeoutMs = 120_000, intervalMs = 3_000, ...request } = options;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await this.status(reference, request);
      if (result.state !== 'pending' || Date.now() + intervalMs > deadline) return result;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
