# @rawdash/connector-gcp-billing

## 0.18.0

### Minor Changes

- 825868d: Add `@rawdash/connector-gcp-monitoring` and `@rawdash/connector-gcp-billing`. The monitoring connector pulls declared Cloud Monitoring metric time series via `projects.timeSeries.list` into one metric series per query (aligner, period, and resource-label filter configurable per query). The billing connector queries the Cloud Billing -> BigQuery export to materialise daily spend, optionally broken down by service, project, SKU, or location. Both authenticate with a Google service-account JSON key.

### Patch Changes

- @rawdash/core@0.18.0
