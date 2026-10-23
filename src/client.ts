import { TokenManager } from './auth.js';
import { HttpClient } from './http.js';
import { Beneficiaries } from './resources/beneficiaries.js';
import { BulkBatches } from './resources/bulkBatches.js';
import { PaymentLinks, PaymentSessions } from './resources/paymentLinks.js';
import { Payments } from './resources/payments.js';
import { Payouts } from './resources/payouts.js';
import { Settings } from './resources/settings.js';
import { Team } from './resources/team.js';
import { Transactions } from './resources/transactions.js';
import { WebhookEndpoints } from './resources/webhookEndpoints.js';
import type { AuthToken, Scope } from './types.js';
import { Webhooks } from './webhooks.js';

export const ENVIRONMENTS = {
  live: 'https://dev.kori.ml',
  sandbox: 'https://sandbox.kori.ml',
} as const;

export type Environment = keyof typeof ENVIRONMENTS;

export interface KoriOptions {
  /** Your API key (`mk_…`). Defaults to `process.env.KORI_API_KEY`. */
  apiKey?: string;
  /** Your API secret (`ms_…`). Defaults to `process.env.KORI_API_SECRET`. Server-side only. */
  apiSecret?: string;
  /**
   * `sandbox` (simulated payments, no money moves) or `live`. Defaults to
   * `process.env.KORI_ENVIRONMENT`, then `sandbox`, so nothing moves money by accident.
   */
  environment?: Environment;
  /** Override the API origin entirely, e.g. for a local server. Wins over `environment`. */
  baseUrl?: string;
  /**
   * Scopes to request for the token. Each endpoint needs one (payouts need `payout`,
   * and so on); if omitted, Kori grants `pay`, `deposit` and `balance` only.
   * Ask for just what this service uses.
   */
  scopes?: Scope[];
  /** Token lifetime, 1–720 hours (Kori's default is 24). The SDK refreshes it for you. */
  tokenTtlHours?: number;
  /** Per-request timeout in milliseconds (default 30 000). */
  timeoutMs?: number;
  /** Retries for failures that are safe to retry (default 2). See the README. */
  maxRetries?: number;
  /** A custom `fetch`, e.g. for a proxy or tests. Defaults to the global one. */
  fetch?: typeof fetch;
}

export class Kori {
  readonly payments: Payments;
  readonly transactions: Transactions;
  readonly payouts: Payouts;
  readonly beneficiaries: Beneficiaries;
  readonly paymentLinks: PaymentLinks;
  readonly paymentSessions: PaymentSessions;
  readonly bulkBatches: BulkBatches;
  readonly team: Team;
  readonly webhookEndpoints: WebhookEndpoints;
  readonly settings: Settings;
  /** Verify incoming webhook deliveries. Needs no credentials. */
  readonly webhooks = new Webhooks();
  readonly baseUrl: string;

  private readonly tokens: TokenManager;

  constructor(options: KoriOptions = {}) {
    const env = typeof process !== 'undefined' ? process.env : {};
    const apiKey = options.apiKey ?? env.KORI_API_KEY;
    const apiSecret = options.apiSecret ?? env.KORI_API_SECRET;
    const environment = options.environment ?? (env.KORI_ENVIRONMENT as Environment | undefined) ?? 'sandbox';

    if (!options.baseUrl && !(environment in ENVIRONMENTS)) {
      throw new TypeError(`Unknown Kori environment "${environment}"; use "sandbox" or "live"`);
    }
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      // The secret grants full API access; it must never ship to a browser.
      console.warn('[kori] The Kori SDK holds your API secret and must only run on a server.');
    }

    this.baseUrl = options.baseUrl ?? ENVIRONMENTS[environment];
    this.tokens = new TokenManager({
      apiKey: apiKey ?? '',
      apiSecret: apiSecret ?? '',
      scopes: options.scopes,
      tokenTtlHours: options.tokenTtlHours,
    });

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new TypeError('No global fetch found (Node 18+ is required), pass `fetch` in the options');

    const http = new HttpClient({
      baseUrl: this.baseUrl,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxRetries: options.maxRetries ?? 2,
      fetch: fetchImpl.bind(globalThis),
      getToken: (force) => {
        if (!apiKey || !apiSecret) {
          return Promise.reject(
            new TypeError('Kori API key and secret are required (options or KORI_API_KEY / KORI_API_SECRET)'),
          );
        }
        return this.tokens.getToken(force);
      },
    });
    this.tokens.attach(http);

    this.payments = new Payments(http);
    this.transactions = new Transactions(http);
    this.payouts = new Payouts(http);
    this.beneficiaries = new Beneficiaries(http);
    this.paymentLinks = new PaymentLinks(http);
    this.paymentSessions = new PaymentSessions(http);
    this.bulkBatches = new BulkBatches(http);
    this.team = new Team(http);
    this.webhookEndpoints = new WebhookEndpoints(http);
    this.settings = new Settings(http);
  }

  /**
   * Exchange the key and secret now and return the token's details (scopes, expiry,
   * merchant). Optional: every call authenticates on its own. Useful at startup to fail
   * fast on bad credentials.
   */
  async authenticate(): Promise<AuthToken> {
    await this.tokens.getToken();
    return this.tokens.current!;
  }
}
