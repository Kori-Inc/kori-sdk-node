import type { RequestOptions } from '../http.js';
import type {
  PaymentLink,
  PaymentLinkCreateParams,
  PaymentLinkListParams,
  PaymentLinkUpdateParams,
  PaymentSession,
  PaymentSessionCreateParams,
} from '../types.js';
import { API, Resource, id } from './base.js';

export class PaymentLinks extends Resource {
  create(params: PaymentLinkCreateParams, options?: RequestOptions): Promise<PaymentLink> {
    return this.data({ ...options, method: 'POST', path: `${API}/payment-links`, body: params });
  }

  list(params?: PaymentLinkListParams, options?: RequestOptions) {
    return this.paginate<PaymentLink, PaymentLinkListParams>(`${API}/payment-links`, 'payment_links', params, options);
  }

  retrieve(linkId: number, options?: RequestOptions): Promise<PaymentLink> {
    return this.data({ ...options, method: 'GET', path: `${API}/payment-links/${id(linkId)}` });
  }

  async update(linkId: number, params: PaymentLinkUpdateParams, options?: RequestOptions): Promise<void> {
    await this.http.request({ ...options, method: 'PUT', path: `${API}/payment-links/${id(linkId)}`, body: params });
  }

  /** Deactivates the link. */
  async delete(linkId: number, options?: RequestOptions): Promise<void> {
    await this.http.request({ ...options, method: 'DELETE', path: `${API}/payment-links/${id(linkId)}` });
  }

  /**
   * Create one payer's checkout on a link, with the amount, your `client_reference_id`
   * and the return URL fixed server-side. Redirect the payer to the session's `url`.
   */
  createSession(linkId: number, params: PaymentSessionCreateParams = {}, options?: RequestOptions): Promise<PaymentSession> {
    return this.data({ ...options, method: 'POST', path: `${API}/payment-links/${id(linkId)}/sessions`, body: params });
  }
}

export class PaymentSessions extends Resource {
  retrieve(sessionId: number, options?: RequestOptions): Promise<PaymentSession> {
    return this.data({ ...options, method: 'GET', path: `${API}/payment-sessions/${id(sessionId)}` });
  }

  /** Stop an open session taking a payment. One already approved on the phone still completes. */
  async cancel(sessionId: number, options?: RequestOptions): Promise<void> {
    await this.http.request({ ...options, method: 'POST', path: `${API}/payment-sessions/${id(sessionId)}/cancel` });
  }
}
