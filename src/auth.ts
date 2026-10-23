import type { HttpClient } from './http.js';
import type { AuthToken, Scope } from './types.js';

// Refresh this long before the token's stated expiry, so a call never leaves with a
// token that dies in flight.
const REFRESH_MARGIN_MS = 60_000;

export interface TokenManagerOptions {
  apiKey: string;
  apiSecret: string;
  scopes?: Scope[];
  tokenTtlHours?: number;
}

/**
 * Exchanges the API key + secret for a Bearer token on first use and keeps it fresh.
 * Concurrent calls share one exchange: `/auth` is rate limited to 20 requests per
 * 15 minutes, so a burst of requests must not each mint a token.
 */
export class TokenManager {
  private token: string | undefined;
  private expiresAt = 0;
  private inflight: Promise<string> | undefined;
  private http: HttpClient | undefined;

  constructor(private readonly opts: TokenManagerOptions) {}

  attach(http: HttpClient): void {
    this.http = http;
  }

  /** The last token issued, with its scopes and merchant, if one has been fetched. */
  current: AuthToken | undefined;

  async getToken(forceRefresh = false): Promise<string> {
    if (forceRefresh) {
      // Drop the refused token, but join an exchange already under way rather than
      // starting a second one.
      this.token = undefined;
      this.expiresAt = 0;
    }
    if (this.token && Date.now() < this.expiresAt - REFRESH_MARGIN_MS) return this.token;
    this.inflight ??= this.exchange().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async exchange(): Promise<string> {
    if (!this.http) throw new Error('TokenManager used before it was attached to a client');
    const body: Record<string, unknown> = {};
    if (this.opts.scopes) body.scopes = this.opts.scopes;
    if (this.opts.tokenTtlHours) body.expires_in_hours = this.opts.tokenTtlHours;

    const res = await this.http.request<{ data: AuthToken }>({
      method: 'POST',
      path: '/merchant/api/auth',
      auth: 'none',
      headers: { 'X-API-Key': this.opts.apiKey, 'X-API-Secret': this.opts.apiSecret },
      body,
      // Minting a second token is harmless, so a timed-out exchange may be retried.
      idempotent: true,
    });

    const data = res.data;
    if (!data?.token) throw new Error('Kori /auth response had no token');
    this.current = data;
    this.token = data.token;
    // `expires_in` is relative, so it holds even when this machine's clock is off;
    // `expires_at` is only the fallback.
    this.expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : Date.parse(data.expires_at ?? '') || Date.now() + 3600_000;
    return data.token;
  }
}
