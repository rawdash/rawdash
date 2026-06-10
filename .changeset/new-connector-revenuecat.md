---
'@rawdash/connector-revenuecat': minor
'@rawdash/connectors': patch
---

Add `@rawdash/connector-revenuecat`, a new connector for the RevenueCat v2 REST API. Syncs products, entitlements, customers, and subscription entities (extracted from each customer's embedded `subscriptions.items` field) plus subscription lifecycle events, and writes a point-in-time snapshot of the project's overview metrics (MRR, active subscriptions, trial conversion rate, ...) on every sync. Authenticates with a project-scoped v2 API key and supports both full backfills and `since`-driven incremental event syncs.
