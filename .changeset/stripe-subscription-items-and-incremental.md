---
'@rawdash/connector-stripe': patch
---

Fix two subscription data-correctness bugs in the Stripe connector. A subscription's `items` is a paginated sub-list (default 10 per page) — when it reports `has_more`, the connector now fetches the full item set via `/v1/subscription_items` before computing `mrrAmount`, so monthly recurring revenue is no longer understated for subscriptions with more than 10 line items. Incremental (`latest`) syncs now re-read all subscriptions with `status=all` instead of constraining them by `created`, so status changes (cancellations, pauses, plan/quantity changes) on subscriptions created before the lookback window are captured rather than left stale. Other entity and event phases keep their existing `created`-window behavior.
