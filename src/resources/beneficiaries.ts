import type { RequestOptions } from '../http.js';
import type { Beneficiary, BeneficiaryCreateParams, BeneficiaryListParams } from '../types.js';
import { API, Resource, id } from './base.js';

export class Beneficiaries extends Resource {
  create(params: BeneficiaryCreateParams, options?: RequestOptions): Promise<Beneficiary> {
    return this.data({ ...options, method: 'POST', path: `${API}/beneficiaries`, body: params });
  }

  list(params?: BeneficiaryListParams, options?: RequestOptions) {
    return this.paginate<Beneficiary, BeneficiaryListParams>(`${API}/beneficiaries`, 'beneficiaries', params, options);
  }

  retrieve(beneficiaryId: number, options?: RequestOptions): Promise<Beneficiary> {
    return this.data({ ...options, method: 'GET', path: `${API}/beneficiaries/${id(beneficiaryId)}` });
  }

  update(beneficiaryId: number, params: BeneficiaryCreateParams, options?: RequestOptions): Promise<Beneficiary> {
    return this.data({ ...options, method: 'PUT', path: `${API}/beneficiaries/${id(beneficiaryId)}`, body: params });
  }

  /** Deactivates the beneficiary; it stays visible with `include_inactive`. */
  async delete(beneficiaryId: number, options?: RequestOptions): Promise<void> {
    await this.http.request({ ...options, method: 'DELETE', path: `${API}/beneficiaries/${id(beneficiaryId)}` });
  }
}
