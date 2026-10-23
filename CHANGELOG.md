# Changelog

## 0.1.0 (unreleased)

First release, covering every endpoint in the Kori Merchant API spec.

- Token exchange and refresh handled automatically, including on a 401.
- Typed resources for payments, transactions, payouts, beneficiaries, payment links and
  sessions, bulk pay, team, webhook endpoints and settings.
- `webhooks.verify()` with typed events.
- `list()` pagination that can be awaited or iterated with `for await`.
- Typed errors, and retries that never repeat a payment or payout after an unclear failure.
