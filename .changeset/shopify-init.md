---
'@rawdash/connector-shopify': minor
---

Add `@rawdash/connector-shopify` — syncs orders, customers, and products as entities plus a derived refund event per order from the Shopify Admin GraphQL API. Authenticates with a Custom App Admin API access token scoped to a `myshopify.com` store domain, supports a `resources` allowlist, and runs backfill plus `updated_at`-based incremental sync.
