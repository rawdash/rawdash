# @rawdash/connector-google-search-console

## 0.29.0

### Patch Changes

- Updated dependencies [48283df]
  - @rawdash/core@0.29.0

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2

## 0.28.1

### Patch Changes

- 9ec9550: Fix metric history loss on incremental syncs. These connectors write historical, past-dated metric samples but re-pull only a short trailing window on incremental (`latest`) syncs, then replaced the whole metric by name — so each incremental sync wiped all previously retained history outside that short window, leaving empty time series and unstable aggregates. Each sales/usage/cost metric write is now scoped to the report window the sync actually fetched (`replaceWindow`), refreshing only those days/hours and preserving older retained samples. Same root cause and fix as the App Store Connect change.
- 9cdec6e: Fix every sync failing with `value.trim is not a function` when the service account key is stored as raw JSON. The secrets resolver auto-parses any secret value beginning with `{` into an object, so the shared `parseServiceAccountJson` helper (bundled into each GCP connector) received the already-parsed service account object rather than a string and crashed on `.trim()`. The shared helper now accepts an already-parsed object — validated with the same schema — in addition to a raw JSON string or base64-encoded JSON, and the `GcpAccessTokenProvider` credential contract is typed accordingly.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Patch Changes

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
