import type { HttpClient, InternalRequest, RequestOptions } from '../http.js';
import { PagePromise } from '../pagination.js';
import type { PageParams, Pagination } from '../types.js';

export const API = '/merchant/api';

export abstract class Resource {
  constructor(protected readonly http: HttpClient) {}

  /** Call the API and return the envelope's `data`. */
  protected async data<T>(req: InternalRequest): Promise<T> {
    const res = await this.http.request<{ data?: T }>(req);
    return res?.data as T;
  }

  /** A paginated list whose `data` is `{ [key]: T[], pagination }`. */
  protected paginate<T, P extends PageParams>(path: string, key: string, params: P | undefined, options?: RequestOptions) {
    return new PagePromise<T>(async (page) => {
      const data = await this.data<Record<string, unknown>>({
        ...options,
        method: 'GET',
        path,
        query: { ...params, ...page } as InternalRequest['query'],
      });
      return {
        items: (data?.[key] as T[] | undefined) ?? [],
        pagination: (data?.pagination as Pagination | undefined) ?? { has_more: false },
      };
    }, params ?? {});
  }
}

/** Path segment for a numeric id, rejecting anything that isn't one. */
export function id(value: number | string): string {
  const s = String(value);
  if (!/^\d+$/.test(s)) throw new TypeError(`Expected a numeric id, got ${JSON.stringify(value)}`);
  return s;
}
