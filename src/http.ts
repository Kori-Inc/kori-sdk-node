import {
  KoriAuthenticationError,
  KoriConnectionError,
  KoriError,
  KoriRateLimitError,
  errorFromResponse,
} from './errors.js';
import { VERSION } from './version.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  /** Abort the request (and any retries) with your own signal. */
  signal?: AbortSignal;
  /** Override the client's timeout for this call, in milliseconds. */
  timeoutMs?: number;
  /** Override the client's retry count for this call. */
  maxRetries?: number;
}

export interface InternalRequest extends RequestOptions {
  method: HttpMethod;
  path: string;
  query?: Query;
  body?: unknown;
  /** `bearer` (default) sends the cached token; `none` sends no credentials. */
  auth?: 'bearer' | 'none';
  /** Extra headers; used by the token exchange. */
  headers?: Record<string, string>;
  /**
   * Whether repeating the call after an ambiguous failure (timeout, 5xx) is safe.
   * Defaults to true for GET/PUT/DELETE and false for POST: a POST to /pay, /deposit or
   * /payouts that timed out may have moved money, so it is never blindly replayed.
   */
  idempotent?: boolean;
}

export interface HttpClientConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetch: typeof fetch;
  getToken: (forceRefresh: boolean) => Promise<string>;
}

// Connection failures where the request provably never reached the server, so even a
// POST can be retried. Anything else (reset, timeout) might have been processed.
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
// A rate-limit wait longer than this is surfaced instead of slept through (the /auth
// limiter's window is 15 minutes).
const MAX_RETRY_AFTER_SECONDS = 30;

export class HttpClient {
  constructor(private readonly config: HttpClientConfig) {}

  async request<T>(req: InternalRequest): Promise<T> {
    const maxRetries = req.maxRetries ?? this.config.maxRetries;
    const idempotent = req.idempotent ?? req.method !== 'POST';
    let refreshedToken = false;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.send(req, refreshedToken);
      } catch (err) {
        // The caller cancelled: hand back their abort reason untouched.
        if (req.signal?.aborted) throw err;
        const error = toConnectionError(err, req);
        const notSent = NOT_SENT_CODES.has(errorCode(err) ?? '');
        if (attempt < maxRetries && (idempotent || notSent) && !req.signal?.aborted) {
          await sleep(backoff(attempt), req.signal);
          continue;
        }
        throw error;
      }

      const body = await parseBody(res);

      if (res.ok) {
        if (body && typeof body === 'object' && (body as { success?: unknown }).success === false) {
          throw errorFromResponse(res.status, body, res.headers);
        }
        return body as T;
      }

      const error = errorFromResponse(res.status, body, res.headers);

      // A 401 on a Bearer call means the token was refused before anything ran, so
      // getting a fresh token and replaying is safe for every method. Once only.
      if (error instanceof KoriAuthenticationError && (req.auth ?? 'bearer') === 'bearer' && !refreshedToken) {
        refreshedToken = true;
        continue;
      }

      if (attempt < maxRetries) {
        if (error instanceof KoriRateLimitError) {
          const wait = error.retryAfter;
          if (wait === undefined || wait <= MAX_RETRY_AFTER_SECONDS) {
            await sleep(wait !== undefined ? wait * 1000 : backoff(attempt), req.signal);
            continue;
          }
        } else if (idempotent && RETRYABLE_STATUS.has(res.status)) {
          await sleep(backoff(attempt), req.signal);
          continue;
        }
      }
      throw error;
    }
  }

  private async send(req: InternalRequest, forceRefresh: boolean): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': `kori-node/${VERSION}`,
      ...req.headers,
    };
    if ((req.auth ?? 'bearer') === 'bearer') {
      headers.Authorization = `Bearer ${await this.config.getToken(forceRefresh)}`;
    }
    let body: string | undefined;
    if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body);
    }

    const { signal, cleanup } = withTimeout(req.timeoutMs ?? this.config.timeoutMs, req.signal);
    try {
      return await this.config.fetch(buildUrl(this.config.baseUrl, req.path, req.query), {
        method: req.method,
        headers,
        body,
        signal,
      });
    } finally {
      cleanup();
    }
  }
}

export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = new URL(baseUrl.replace(/\/+$/, '') + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // nginx error pages and the like: keep the text so it shows up in `error.body`.
    return text;
  }
}

function withTimeout(ms: number, userSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  // AbortSignal.any is Node 20+, so the two signals are joined by hand for Node 18.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(ms)), ms);
  const onAbort = () => controller.abort(userSignal?.reason);
  if (userSignal?.aborted) onAbort();
  else userSignal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      userSignal?.removeEventListener('abort', onAbort);
    },
  };
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

function errorCode(err: unknown): string | undefined {
  // undici wraps the socket error: TypeError('fetch failed', { cause: { code } }).
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code ?? e?.cause?.code;
}

function toConnectionError(err: unknown, req: InternalRequest): KoriError {
  if (err instanceof KoriError) return err;
  const reason = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: unknown })?.cause;
  const detail = cause instanceof Error && cause.message !== reason ? `: ${cause.message}` : '';
  return new KoriConnectionError(`${req.method} ${req.path} failed: ${reason}${detail}`, { cause: err });
}

function backoff(attempt: number): number {
  // 0.5s, 1s, 2s, 4s… capped at 8s, with full jitter.
  return Math.random() * Math.min(8000, 500 * 2 ** attempt);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}
