import type { PageParams, Pagination } from './types.js';

export interface Page<T> {
  /** The items on this page. */
  data: T[];
  pagination: Pagination;
  hasMore: boolean;
  /** Fetch the following page. Throws when `hasMore` is false. */
  nextPage(): Promise<Page<T>>;
}

type FetchPage<T> = (params: PageParams) => Promise<{ items: T[]; pagination: Pagination }>;

/**
 * What every paginated `list()` returns. `await` it for the first page, or iterate it
 * with `for await` to walk every item across all pages:
 *
 *   const page = await kori.payouts.list({ limit: 20 });
 *   for await (const payout of kori.payouts.list({ status: 'pending' })) { … }
 */
export class PagePromise<T> implements PromiseLike<Page<T>>, AsyncIterable<T> {
  private first: Promise<Page<T>> | undefined;

  constructor(
    private readonly fetchPage: FetchPage<T>,
    private readonly params: PageParams,
  ) {}

  then<A = Page<T>, B = never>(
    onFulfilled?: ((page: Page<T>) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.first ??= this.load(this.params);
    return this.first.then(onFulfilled, onRejected);
  }

  catch<B = never>(onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<Page<T> | B> {
    return this.then(undefined, onRejected);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page: Page<T> = await this;
    for (;;) {
      yield* page.data;
      if (!page.hasMore || page.data.length === 0) return;
      page = await page.nextPage();
    }
  }

  private async load(params: PageParams): Promise<Page<T>> {
    const { items, pagination } = await this.fetchPage(params);
    const hasMore = Boolean(pagination?.has_more);
    return {
      data: items,
      pagination,
      hasMore,
      nextPage: () => {
        if (!hasMore) return Promise.reject(new Error('No more pages'));
        const offset = (pagination.offset ?? params.offset ?? 0) + items.length;
        return this.load({ ...params, offset });
      },
    };
  }
}
