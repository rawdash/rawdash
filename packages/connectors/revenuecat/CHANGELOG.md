# @rawdash/connector-revenuecat

## 0.26.0

### Patch Changes

- @rawdash/core@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0

## 0.22.0

### Minor Changes

- 41d4d01: Add `@rawdash/connector-revenuecat`, a new connector for the RevenueCat v2 REST API. Syncs products, entitlements, customers, and subscription entities (extracted from each customer's embedded `subscriptions.items` field) plus subscription lifecycle events, and writes a point-in-time snapshot of the project's overview metrics (MRR, active subscriptions, trial conversion rate, ...) on every sync. Authenticates with a project-scoped v2 API key and supports both full backfills and `since`-driven incremental event syncs.

### Patch Changes

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0
