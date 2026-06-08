# @rawdash/connector-meta-ads

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

- a36406e: Add `@rawdash/connector-meta-ads` — syncs Meta (Facebook + Instagram) Ads. Writes ad-account campaigns as `meta_campaign` entities and pulls daily campaign, adset, and ad-level insights (spend, impressions, clicks, reach, conversions, conversion value) as `meta_campaign_insights` / `meta_adset_insights` / `meta_ad_insights` metric series. Authenticates with a long-lived Meta Business Manager System User access token (`accessToken: secret('META_ACCESS_TOKEN')`) and an `act_<id>` ad account. Supports backfill via `lookbackDays` (default 90), incremental syncs with a 30-day trailing window, chunked-sync pagination through `paging.cursors.after`, and a `resources` allowlist for opting out of high-cardinality ad-level insights.

### Patch Changes

- @rawdash/core@0.17.0
