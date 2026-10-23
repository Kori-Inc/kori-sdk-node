import type { RequestOptions } from '../http.js';
import type {
  WebhookCreateParams,
  WebhookEndpoint,
  WebhookEndpointWithSecret,
  WebhookSecret,
  WebhookUpdateParams,
} from '../types.js';
import { API, Resource, id } from './base.js';

/** Manage the URLs Kori delivers webhooks to. To check a delivery, use `kori.webhooks`. */
export class WebhookEndpoints extends Resource {
  /** Register an endpoint. The returned `secret` is shown only once: store it. */
  create(params: WebhookCreateParams, options?: RequestOptions): Promise<WebhookEndpointWithSecret> {
    return this.data({ ...options, method: 'POST', path: `${API}/webhooks`, body: params });
  }

  async list(options?: RequestOptions): Promise<WebhookEndpoint[]> {
    const data = await this.data<{ webhooks?: WebhookEndpoint[] }>({ ...options, method: 'GET', path: `${API}/webhooks` });
    return data?.webhooks ?? [];
  }

  retrieve(webhookId: number, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.data({ ...options, method: 'GET', path: `${API}/webhooks/${id(webhookId)}` });
  }

  update(webhookId: number, params: WebhookUpdateParams, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.data({ ...options, method: 'PUT', path: `${API}/webhooks/${id(webhookId)}`, body: params });
  }

  async delete(webhookId: number, options?: RequestOptions): Promise<void> {
    await this.http.request({ ...options, method: 'DELETE', path: `${API}/webhooks/${id(webhookId)}` });
  }

  /** Deliver a sample `test` event to the endpoint. */
  async sendTest(webhookId: number, options?: RequestOptions): Promise<void> {
    await this.http.request({ ...options, method: 'POST', path: `${API}/webhooks/${id(webhookId)}/test` });
  }

  /**
   * Issue a new signing secret, effective immediately: deliveries in flight under the
   * old one will fail verification until you deploy the new secret.
   */
  rotateSecret(webhookId: number, options?: RequestOptions): Promise<WebhookSecret> {
    return this.data({ ...options, method: 'POST', path: `${API}/webhooks/${id(webhookId)}/rotate-secret` });
  }
}
