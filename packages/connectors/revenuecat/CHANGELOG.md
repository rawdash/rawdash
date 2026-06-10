# @rawdash/connector-revenuecat

## 0.22.0

### Minor Changes

- 41d4d01: Add `@rawdash/connector-revenuecat`, a new connector for the RevenueCat v2 REST API. Syncs products, entitlements, customers, and subscription entities (extracted from each customer's embedded `subscriptions.items` field) plus subscription lifecycle events, and writes a point-in-time snapshot of the project's overview metrics (MRR, active subscriptions, trial conversion rate, ...) on every sync. Authenticates with a project-scoped v2 API key and supports both full backfills and `since`-driven incremental event syncs.

### Patch Changes

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0
