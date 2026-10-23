/**
 * Every error the SDK throws for an API response is a `KoriError` (or a subclass),
 * carrying the HTTP status, the server's message and its `request_id` for support.
 */
export class KoriError extends Error {
  /** HTTP status, or undefined when the request never got a response. */
  readonly status: number | undefined;
  /** Kori's `request_id`, when the response had one. Quote it to support. */
  readonly requestId: string | undefined;
  /** The parsed response body, as sent by the API. */
  readonly body: unknown;

  constructor(message: string, opts: { status?: number; requestId?: string; body?: unknown; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = new.target.name;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.body = opts.body;
  }
}

/** 400: the request was rejected as invalid (bad field, amount below minimum, insufficient balance…). */
export class KoriValidationError extends KoriError {}

/** 401: the API key/secret or the Bearer token was refused. */
export class KoriAuthenticationError extends KoriError {}

/** 403: the token lacks a scope, the IP is not allow-listed, or the merchant is inactive. */
export class KoriPermissionError extends KoriError {
  /** The scopes the endpoint accepts, when the API said which. */
  readonly requiredScopes: string[] | undefined;

  constructor(message: string, opts: ConstructorParameters<typeof KoriError>[1] & { requiredScopes?: string[] } = {}) {
    super(message, opts);
    this.requiredScopes = opts.requiredScopes;
  }
}

/** 404: no such resource for this merchant. */
export class KoriNotFoundError extends KoriError {}

/**
 * 409: a conflict, most often a reused `reference`. For a duplicate payment,
 * `existingTransaction` is the transaction that already holds the reference.
 */
export class KoriConflictError extends KoriError {
  readonly existingTransaction: { id: number; status: string } | undefined;

  constructor(message: string, opts: ConstructorParameters<typeof KoriError>[1] & { existingTransaction?: { id: number; status: string } } = {}) {
    super(message, opts);
    this.existingTransaction = opts.existingTransaction;
  }
}

/** 429: too many requests. `retryAfter` is in seconds, when the API said. */
export class KoriRateLimitError extends KoriError {
  readonly retryAfter: number | undefined;

  constructor(message: string, opts: ConstructorParameters<typeof KoriError>[1] & { retryAfter?: number } = {}) {
    super(message, opts);
    this.retryAfter = opts.retryAfter;
  }
}

/** 5xx: Kori or the mobile-money operator failed. The outcome of a write may be unknown. */
export class KoriServerError extends KoriError {}

/**
 * The request did not complete: DNS, connection, or timeout. For a write that moves
 * money, the server may or may not have processed it; check by `reference` before retrying.
 */
export class KoriConnectionError extends KoriError {}

/** A webhook's signature did not match its body. Reject the delivery. */
export class KoriSignatureVerificationError extends KoriError {}

export function errorFromResponse(status: number, body: unknown, headers: Headers): KoriError {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const message = typeof b.message === 'string' && b.message ? b.message : `Kori API responded ${status}`;
  const opts = {
    status,
    body,
    requestId: (typeof b.request_id === 'string' ? b.request_id : undefined) ?? headers.get('x-request-id') ?? undefined,
  };

  switch (true) {
    case status === 400:
    case status === 422:
      return new KoriValidationError(message, opts);
    case status === 401:
      return new KoriAuthenticationError(message, opts);
    case status === 403:
      return new KoriPermissionError(message, {
        ...opts,
        requiredScopes: Array.isArray(b.required_scopes) ? (b.required_scopes as string[]) : undefined,
      });
    case status === 404:
      return new KoriNotFoundError(message, opts);
    case status === 409:
      return new KoriConflictError(message, {
        ...opts,
        existingTransaction: b.existing_transaction as { id: number; status: string } | undefined,
      });
    case status === 429:
      return new KoriRateLimitError(message, { ...opts, retryAfter: parseRetryAfter(headers) });
    case status >= 500:
      return new KoriServerError(message, opts);
    default:
      return new KoriError(message, opts);
  }
}

export function parseRetryAfter(headers: Headers): number | undefined {
  // express-rate-limit sends `Retry-After` (seconds) and the draft `RateLimit-Reset`.
  const raw = headers.get('retry-after') ?? headers.get('ratelimit-reset');
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
