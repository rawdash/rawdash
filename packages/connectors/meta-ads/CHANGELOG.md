# @rawdash/connector-meta-ads

## 0.24.0

### Patch Changes

- ad70083: Add widget `format` field for display formatting; currency format derives scale from field's declared unit

  Widgets (stat, timeseries, distribution) now accept an optional `format` field:

  ```ts
  format?: {
    kind: 'currency' | 'number' | 'percent' | 'duration' | 'bytes';
    currency?: string;  // e.g. 'USD'
    decimals?: number;
    compact?: boolean;  // render as 1.2M
  }
  ```

  For `kind: 'currency'`, the scale divisor is derived automatically from the metric field's declared `unit` — a field declared `unit: 'cents'` produces `scale: 100` in the API response, so the frontend divides raw cents by 100 to display dollars. No magic numbers needed in widget config.

  The widgets API (`CachedWidget`) now carries a `format` field (type `ResolvedWidgetFormat`) alongside `data`, including the derived `scale` for currency widgets when connector resource definitions are available.

  **Validation updates (RAW-522 follow-up):**
  - The existing cents-without-conversion warning now points to `format: { kind: 'currency' }` as the fix.
  - The warning is suppressed when the widget already sets `format: { kind: 'currency' }`.
  - A new warning fires when `format: { kind: 'currency' }` is set on a field with no declared currency unit.

  **Connector audit:**
  - `@rawdash/connector-google-ads`: resource `unit` updated from `'cost'` to `'USD'` (values were already stored in full currency units after micros conversion).
  - `@rawdash/connector-meta-ads`: resource `unit` updated from `'spend'` to `'USD'`.

  **New exports from `@rawdash/core`:** `WidgetFormat`, `ResolvedWidgetFormat`, `widgetFormatSchema`, `currencyScaleFromUnit`.

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
