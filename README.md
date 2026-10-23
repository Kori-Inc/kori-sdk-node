# @kori/node

The official Node.js and TypeScript SDK for the [Kori Merchant API](https://kori.ml): collect
mobile-money payments (Orange Money, Wave, Moov) in Mali, send payouts and bulk payments,
create payment links and checkout sessions, and verify webhooks.

```sh
npm install @kori/node
```

Node 18+. ESM and CommonJS. No runtime dependencies: it uses only `fetch` and `node:crypto`,
so Bun and Deno should work, though they aren't tested yet. **Server-side only**: the
SDK holds your API secret.

## Quick start

```ts
import { Kori } from '@kori/node';

const kori = new Kori({
  apiKey: process.env.KORI_API_KEY,
  apiSecret: process.env.KORI_API_SECRET,
  environment: 'sandbox', // or 'live'
  scopes: ['pay', 'balance'],
});

const payment = await kori.payments.collect({
  amount: 5000, // XOF has no minor unit: this is 5 000 francs
  payment_method: 'OrangeMoney',
  customer_phone: '+22370000000',
  reference: 'order_1042', // your id: the idempotency key
});
// payment.status === 'pending': the customer has only been prompted.
```

`apiKey`, `apiSecret` and `environment` fall back to `KORI_API_KEY`, `KORI_API_SECRET` and
`KORI_ENVIRONMENT`. The environment defaults to `sandbox`, so nothing moves money until you
choose `live`.

### Authentication and scopes

You never call `/auth` yourself. The SDK swaps your key and secret for a Bearer token on the
first request, shares it across concurrent calls, and fetches a new one before it expires or
when the API refuses it. Call `await kori.authenticate()` at startup if you want bad
credentials to fail straight away.

Every endpoint needs a scope, and a token only has the scopes you ask for. Without `scopes`,
Kori grants `pay`, `deposit` and `balance`. A missing scope throws `KoriPermissionError`, and
its `requiredScopes` tells you which one to add.

| Resource | Scope |
| --- | --- |
| `payments.collect` | `pay` |
| `payments.deposit` | `deposit` |
| `payments.balance`, `transactions.*` | `balance` |
| `payouts.*` | `payout` |
| `beneficiaries.*` | `beneficiaries` |
| `bulkBatches.*` | `bulk_pay` |
| `paymentLinks.*`, `paymentSessions.*` | `payment_links` |
| `team.*` | `team` |
| `webhookEndpoints.*` | `webhooks` |
| `settings.*` | `settings` |

## Confirming a payment

`collect()` only prompts the customer. Mark an order paid when the **`payment_received`
webhook** arrives (see below). If a customer is waiting on screen, you can also poll:

```ts
const result = await kori.payments.waitForResult(payment.reference!, { timeoutMs: 120_000 });
if (result.state === 'success') { /* paid */ }
// 'pending' after the timeout is not a failure: the payment can still complete.
```

## Webhooks

```ts
import express from 'express';

app.post('/webhooks/kori', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = kori.webhooks.verify(req.body, req.get('x-kori-signature'), process.env.KORI_WEBHOOK_SECRET!);
  } catch {
    return res.sendStatus(400);
  }

  switch (event.event) {
    case 'payment_received':
    case 'payment_link_used':
      markPaid(event.data.reference, event.data.amount, event.data.client_reference_id);
      break;
    case 'payout_failed':
      // the amount was refunded to your balance
      break;
  }
  res.sendStatus(200);
});
```

Pass the **raw** body. A body that has been parsed and re-serialized won't match the
signature. Events are typed, so `event.data` narrows on `event.event`. Answer with a 2xx
quickly and do slow work afterwards.

Register endpoints with `kori.webhookEndpoints.create({ url, events })`. The returned `secret`
is shown once. `kori.webhooks.sign(body, secret)` produces a valid signature for testing your
handler.

## Lists and pagination

`list()` resolves to the first page. Iterate it with `for await` to walk every page:

```ts
const page = await kori.payouts.list({ status: 'pending', limit: 20 });
page.data; page.hasMore; await page.nextPage();

for await (const payout of kori.payouts.list({ status: 'pending' })) {
  console.log(payout.id, payout.amount);
}
```

## Errors

Each API error is a `KoriError` with `status`, `message`, `requestId` (quote it to support)
and the raw `body`:

| Class | When |
| --- | --- |
| `KoriValidationError` | 400: invalid field, amount below minimum, insufficient balance |
| `KoriAuthenticationError` | 401: bad key/secret or token |
| `KoriPermissionError` | 403: missing scope (`requiredScopes`), IP not allow-listed, inactive merchant |
| `KoriNotFoundError` | 404 |
| `KoriConflictError` | 409: reused `reference` (`existingTransaction`), slug taken, session closed |
| `KoriRateLimitError` | 429 (`retryAfter` in seconds) |
| `KoriServerError` | 5xx |
| `KoriConnectionError` | no response: DNS, connection or timeout |

## Retries and money safety

The SDK retries a failed request up to `maxRetries` times (default 2), with backoff, but only
when a repeat can't do anything twice:

- **Reads, updates and deletes** (GET/PUT/DELETE) are retried after timeouts, connection
  errors and 500/502/503/504.
- **Creates** (POST) are retried only when the request never reached Kori (connection
  refused, DNS failure) or was rate limited.
- **`payments.collect`, `payments.deposit` and `payouts.create` are never retried after a
  timeout or 5xx.** The operator may already have prompted the customer or sent the money.
  Look the payment up by your `reference` before trying again. A repeat with the same
  `reference` is refused with `KoriConflictError`, so it can't charge twice.
- A 429 is waited out when `Retry-After` is 30 seconds or less. Longer waits throw
  `KoriRateLimitError` straight away.

Every method takes a final `options` argument: `{ signal, timeoutMs, maxRetries }`.

## Resources

| | |
| --- | --- |
| `payments` | `collect`, `deposit`, `balance`, `status`, `waitForResult` |
| `transactions` | `list`, `retrieve` |
| `payouts` | `create`, `list`, `retrieve`, `approve`, `cancel` |
| `beneficiaries` | `create`, `list`, `retrieve`, `update`, `delete` |
| `paymentLinks` | `create`, `list`, `retrieve`, `update`, `delete`, `createSession` |
| `paymentSessions` | `retrieve`, `cancel` |
| `bulkBatches` | `create`, `list`, `retrieve`, `addRecipients`, `listRecipients`, `process`, `cancel` |
| `team` | `list`, `invite`, `retrieve`, `updateRole`, `remove` |
| `webhookEndpoints` | `create`, `list`, `retrieve`, `update`, `delete`, `sendTest`, `rotateSecret` |
| `settings` | `retrieve`, `update` |
| `webhooks` | `verify`, `isValidSignature`, `sign` |

## Sandbox

`environment: 'sandbox'` simulates payments, and no money moves. The outcome depends on the
customer's phone number:

| Number | Outcome |
| --- | --- |
| `70000000` | success |
| `70000001` | failed |
| `70000002` | stays pending |
| `70000003` | the start call times out, then the payment succeeds |

Any other number succeeds.

## Development

Types come from the API's OpenAPI spec (`docs-site/openapi.yaml`):

```sh
npm run generate   # rebuild src/generated/openapi.ts (OPENAPI_SPEC=path to override)
npm run typecheck
npm test           # unit tests; sandbox tests run when KORI_SANDBOX_API_KEY/SECRET are set
npm run build
```
