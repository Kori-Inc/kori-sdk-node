import type { RequestOptions } from '../http.js';
import type { Transaction, TransactionListParams } from '../types.js';
import { API, Resource, id } from './base.js';

export class Transactions extends Resource {
  list(params?: TransactionListParams, options?: RequestOptions) {
    return this.paginate<Transaction, TransactionListParams>(`${API}/transactions`, 'transactions', params, options);
  }

  retrieve(transactionId: number, options?: RequestOptions): Promise<Transaction> {
    return this.data({ ...options, method: 'GET', path: `${API}/transactions/${id(transactionId)}` });
  }
}
