import type { RequestOptions } from '../http.js';
import type { Payout, PayoutCreateParams, PayoutListParams } from '../types.js';
import { API, Resource, id } from './base.js';

export class Payouts extends Resource {
  /**
   * Withdraw from your balance. Depending on your settings the payout may wait for
   * `approve()`. Pass your own `reference`; like `payments.collect`, this call is never
   * retried after an ambiguous failure.
   */
  create(params: PayoutCreateParams, options?: RequestOptions): Promise<Payout> {
    return this.data({ ...options, method: 'POST', path: `${API}/payouts`, body: params });
  }

  list(params?: PayoutListParams, options?: RequestOptions) {
    return this.paginate<Payout, PayoutListParams>(`${API}/payouts`, 'payouts', params, options);
  }

  retrieve(payoutId: number, options?: RequestOptions): Promise<Payout> {
    return this.data({ ...options, method: 'GET', path: `${API}/payouts/${id(payoutId)}` });
  }

  approve(payoutId: number, options?: RequestOptions): Promise<Payout> {
    return this.data({ ...options, method: 'POST', path: `${API}/payouts/${id(payoutId)}/approve` });
  }

  async cancel(payoutId: number, options?: RequestOptions): Promise<void> {
    await this.http.request({ ...options, method: 'POST', path: `${API}/payouts/${id(payoutId)}/cancel` });
  }
}
