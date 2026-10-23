// Friendly names for the types generated from the OpenAPI spec (src/generated/openapi.ts).
// Regenerate with `npm run generate`; never edit the generated file by hand.
import type { components, operations } from './generated/openapi.js';

type Schemas = components['schemas'];

type JsonOf<R> = R extends { content: { 'application/json': infer J } } ? J : never;
type SuccessJson<K extends keyof operations> = JsonOf<
  operations[K]['responses'][Extract<keyof operations[K]['responses'], 200 | 201 | 202>]
>;
/** The unwrapped `data` of an operation's success response. */
export type DataOf<K extends keyof operations> = NonNullable<
  SuccessJson<K> extends infer J ? (J extends { data?: infer D } ? D : never) : never
>;
type BodyOf<K extends keyof operations> = operations[K] extends {
  requestBody?: { content: { 'application/json': infer B } };
}
  ? B
  : never;
type QueryOf<K extends keyof operations> = NonNullable<operations[K]['parameters']['query']>;

export type Scope = Schemas['Scope'];
export type PaymentMethod = Schemas['PaymentMethod'];
export type PayoutMethod = Schemas['PayoutMethod'];
export type TransactionStatus = Schemas['TransactionStatus'];
export type PayoutStatus = Schemas['PayoutStatus'];
export type BulkStatus = Schemas['BulkStatus'];
export type BeneficiaryCategory = Schemas['BeneficiaryCategory'];
export type TeamRole = Schemas['TeamRole'];
export type WebhookEventType = Schemas['WebhookEvent'];
export type Pagination = Schemas['Pagination'];

export type PayParams = Schemas['PayRequest'];
export type DepositParams = Schemas['DepositRequest'];
export type TransactionResult = Schemas['TransactionResult'];
export type Transaction = Schemas['Transaction'];
export type TransactionListParams = QueryOf<'listTransactions'>;
export type Balance = DataOf<'getBalance'>;
export type PaymentStatus = SuccessJson<'getPaymentStatus'>;

export type PayoutCreateParams = Schemas['PayoutRequest'];
export type Payout = Schemas['Payout'];
export type PayoutListParams = QueryOf<'listPayouts'>;

export type BeneficiaryCreateParams = Schemas['BeneficiaryInput'];
export type Beneficiary = Schemas['Beneficiary'];
export type BeneficiaryListParams = QueryOf<'listBeneficiaries'>;

export type PaymentLinkCreateParams = Schemas['PaymentLinkInput'];
export type PaymentLinkUpdateParams = Schemas['PaymentLinkUpdate'];
export type PaymentLink = Schemas['PaymentLink'];
export type PaymentLinkListParams = QueryOf<'listPaymentLinks'>;
export type PaymentSessionCreateParams = Schemas['PaymentSessionInput'];
export type PaymentSession = Schemas['PaymentSession'];

export type BulkRecipientParams = Schemas['BulkRecipientInput'];
export type BulkRecipient = Schemas['BulkRecipient'];
export type BulkBatch = Schemas['BulkBatch'];
export type BulkBatchListParams = QueryOf<'listBulkBatches'>;
export type BulkRecipientsAdded = DataOf<'addBulkRecipients'>;
export type BulkBatchProcessing = DataOf<'processBulkBatch'>;
export type BulkBatchCancelled = DataOf<'cancelBulkBatch'>;

export type TeamMember = Schemas['TeamMember'];
export type TeamInviteParams = BodyOf<'inviteTeamMember'>;

export type WebhookCreateParams = Schemas['WebhookInput'];
export type WebhookUpdateParams = BodyOf<'updateWebhook'>;
export type WebhookEndpoint = Schemas['Webhook'];
export type WebhookEndpointWithSecret = Schemas['WebhookWithSecret'];
export type WebhookSecret = DataOf<'rotateWebhookSecret'>;

export type Settings = Schemas['Settings'];
export type SettingsUpdateParams = Schemas['SettingsUpdate'];

export type AuthToken = DataOf<'createToken'>;

/** Pagination controls shared by every paginated list. */
export interface PageParams {
  /** Items per page, 1–100 (default 50). */
  limit?: number;
  /** Items to skip (default 0). */
  offset?: number;
}
