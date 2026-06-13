# @rawdash/connector-google-search-console

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

- 0b6099b: Migrate the Google-API connectors to the shared `GcpAccessTokenProvider` from `@rawdash/connector-gcp-shared` instead of connector-local JWT signing and OAuth token handling. No behavior change — the token requests are identical; this removes duplicated service-account and refresh-token auth code so a fix to GCP auth only has to land in one place.
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

- 78ce58e: Add `@rawdash/connector-google-search-console` - syncs Google Search Console SEO metrics (clicks, impressions, CTR, average position) for a verified URL-prefix or sc-domain property. Resources cover daily totals plus per-query, per-page, and per-country breakdowns. Authentication supports both a Google service account JSON key and an OAuth 2.0 refresh-token tuple with the `webmasters.readonly` scope. Backfill defaults to a trailing 90 days; incremental syncs refetch the trailing 3 days to absorb Search Console's standard 2-3 day reporting lag.

### Patch Changes

- @rawdash/core@0.17.0
