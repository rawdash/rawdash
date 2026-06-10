# @rawdash/connector-gcp-billing

## 0.22.0

### Patch Changes

- beb78ff: Require a `domain` field on connector vendor metadata, and give each connector a vendor domain.

  `connectorDocSchema` now requires `vendor.domain` (a validated hostname), so every connector declares the vendor's domain. This is a breaking change for connector authors using `@rawdash/core` directly. All built-in connectors now set `vendor.domain`.

- 4e7c58e: Fix BigQuery result pagination. `runQuery` previously re-issued `POST /bigquery/v2/projects/{projectId}/queries` with `body.pageToken` to fetch later pages, but `jobs.query` ignores `pageToken`, so the same first page was re-fetched and the paging loop could run indefinitely once a result set exceeded `maxResults`. Subsequent pages are now fetched via `jobs.getQueryResults` (`GET /bigquery/v2/projects/{projectId}/queries/{jobId}?pageToken=...&location=...`), threading the `jobReference` returned by the initial query through the paging loop.
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

### Minor Changes

- 825868d: Add `@rawdash/connector-gcp-monitoring` and `@rawdash/connector-gcp-billing`. The monitoring connector pulls declared Cloud Monitoring metric time series via `projects.timeSeries.list` into one metric series per query (aligner, period, and resource-label filter configurable per query). The billing connector queries the Cloud Billing -> BigQuery export to materialise daily spend, optionally broken down by service, project, SKU, or location. Both authenticate with a Google service-account JSON key.

### Patch Changes

- @rawdash/core@0.18.0
