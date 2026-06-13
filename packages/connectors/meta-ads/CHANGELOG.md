# @rawdash/connector-meta-ads

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
