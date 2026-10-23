import type { RequestOptions } from '../http.js';
import type {
  BulkBatch,
  BulkBatchCancelled,
  BulkBatchListParams,
  BulkBatchProcessing,
  BulkRecipient,
  BulkRecipientParams,
  BulkRecipientsAdded,
  PageParams,
} from '../types.js';
import { API, Resource, id } from './base.js';

export class BulkBatches extends Resource {
  /** Create a draft batch. Nothing is paid until `process()`. */
  create(recipients: BulkRecipientParams[], options?: RequestOptions): Promise<BulkBatch> {
    return this.data({ ...options, method: 'POST', path: `${API}/bulk/batches`, body: { recipients } });
  }

  list(params?: BulkBatchListParams, options?: RequestOptions) {
    return this.paginate<BulkBatch, BulkBatchListParams>(`${API}/bulk/batches`, 'batches', params, options);
  }

  retrieve(batchId: number, options?: RequestOptions): Promise<BulkBatch> {
    return this.data({ ...options, method: 'GET', path: `${API}/bulk/batches/${id(batchId)}` });
  }

  addRecipients(batchId: number, recipients: BulkRecipientParams[], options?: RequestOptions): Promise<BulkRecipientsAdded> {
    return this.data({ ...options, method: 'POST', path: `${API}/bulk/batches/${id(batchId)}/recipients`, body: { recipients } });
  }

  listRecipients(batchId: number, params?: PageParams, options?: RequestOptions) {
    return this.paginate<BulkRecipient, PageParams>(`${API}/bulk/batches/${id(batchId)}/recipients`, 'recipients', params, options);
  }

  /** Start paying a draft batch. Recipients are paid in the background; watch for `bulk_pay_done`. */
  process(batchId: number, options?: RequestOptions): Promise<BulkBatchProcessing> {
    return this.data({ ...options, method: 'POST', path: `${API}/bulk/batches/${id(batchId)}/process` });
  }

  cancel(batchId: number, options?: RequestOptions): Promise<BulkBatchCancelled> {
    return this.data({ ...options, method: 'POST', path: `${API}/bulk/batches/${id(batchId)}/cancel` });
  }
}
