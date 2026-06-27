# @rawdash/connector-posthog

## 0.28.1

### Patch Changes

- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Minor Changes

- 0e4102e: Standardize PostHog metric output to the canonical metric-shape contract. The primary count/users number now lives only in the `MetricSample` `value` field and is no longer mirrored into `attributes` (removed `count` from `posthog_events_per_day`, `callCount` from `posthog_feature_flag_usage`, and `users` from `posthog_funnel`). Secondary numerics (`distinctUsers`, `uniqueUsers`, `conversionRate`) are now declared as `measures`; categorical fields remain `dimensions`. Reference metric widgets with `field: 'value'` (or omit `field`).

### Patch Changes

- 6a1ccc1: Update the `active_users` schema to match observed upstream shape drift (RAW-658).
- ea5dd52: Update the `events_per_day` schema to match observed upstream shape drift (RAW-641).
- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0

## 0.27.0

### Patch Changes

- @rawdash/core@0.27.0

## 0.26.0

### Patch Changes

- @rawdash/core@0.26.0

## 0.25.0

### Patch Changes

- f81452a: Update the `active_users` schema to accept the additional PostHog trends-envelope and per-result fields observed upstream (RAW-482).
- c0412a1: Update the `events_per_day` schema to accept the additional PostHog query-envelope fields observed upstream (RAW-481).
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

### Patch Changes

- beb78ff: Require a `domain` field on connector vendor metadata, and give each connector a vendor domain.

  `connectorDocSchema` now requires `vendor.domain` (a validated hostname), so every connector declares the vendor's domain. This is a breaking change for connector authors using `@rawdash/core` directly. All built-in connectors now set `vendor.domain`.

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0

## 0.21.1

### Patch Changes

- @rawdash/core@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Patch Changes

- 66d2e20: Accelerate PostHog syncs. Pagination now pipelines page fetches with storage writes and yields a resumable cursor on a soft 25s per-chunk budget. The feature-flags page size honours the new `SyncOptions.pageSize` (clamped to a safe ceiling).
- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0

## 0.17.0

### Patch Changes

- @rawdash/core@0.17.0

## 0.16.0

### Minor Changes

- 591fdea: Add `@rawdash/connector-posthog` — syncs PostHog product analytics into the six-shape storage model: feature flags (as entities), per-day event volume and feature-flag usage (HogQL rollups), DAU/WAU/MAU (a single Trends query split by `window` attribute), and declared funnels (one FunnelsQuery per funnel, with per-step conversion rates). Authenticates with a personal API key against PostHog Cloud (US/EU) or a self-hosted host. Backfills over a configurable lookback window and incrementally syncs by passing `options.since` into the rollup window; feature flags paginate by offset and funnels by index so interrupted syncs resume.

### Patch Changes

- Updated dependencies [422b711]
- Updated dependencies [79fdd64]
- Updated dependencies [a1c4c66]
- Updated dependencies [074ec25]
- Updated dependencies [022cbf1]
- Updated dependencies [e104540]
- Updated dependencies [9169ceb]
- Updated dependencies [5026a5b]
- Updated dependencies [c27c332]
- Updated dependencies [e8b014a]
- Updated dependencies [7060534]
- Updated dependencies [d52a6a8]
- Updated dependencies [d17a523]
  - @rawdash/core@0.16.0
