# @rawdash/connector-google-ads

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Patch Changes

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

### Minor Changes

- 27e0a6d: Add `@rawdash/connector-google-ads` — a Google Ads connector that syncs campaigns (as entities) plus daily campaign / ad-group / keyword performance metrics (impressions, clicks, cost, conversions, conversion value, historical quality score) into the six-shape storage model via GAQL against the `googleAds:search` endpoint. Authenticates with an OAuth 2.0 refresh token plus a developer token; supports MCC (manager-account) access via the `login-customer-id` header. Backfill window (default 90 days) and incremental sync (3-day rolling, matching Google Ads' attribution window) are both supported, with phase- and pageToken-resumable cursors and `options.resources` allowlist support so dashboards that only need campaign-level metrics don't pull keyword-level data.

### Patch Changes

- @rawdash/core@0.17.0
