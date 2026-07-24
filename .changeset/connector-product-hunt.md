---
'@rawdash/connector-product-hunt': minor
'@rawdash/connectors': patch
---

Add `@rawdash/connector-product-hunt`, a connector for Product Hunt launches.

It syncs two resources from the Product Hunt GraphQL API with a single API access token: `product_hunt_post` entities (name, tagline, vote/comment/review counters, daily and weekly rank, topics, launch timestamps) and `product_hunt_post_metrics` metric samples (a per-UTC-day snapshot of the same counters, valued on upvotes) for launch-day velocity and rank-trajectory widgets.

Track specific launches with `slugs`, or sync the whole feed over a `lookbackDays` window, optionally narrowed to one `topic`. Incremental syncs push `options.since` into the API's `postedAfter` filter, and the current day's metric samples are replaced on every sync so re-syncing stays idempotent.
