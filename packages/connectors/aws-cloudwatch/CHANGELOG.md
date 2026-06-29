# @rawdash/connector-aws-cloudwatch

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

- bf76511: Clamp each GetMetricData query's window to CloudWatch's resolution-based retention floor and surface per-series result statuses. CloudWatch returns no data points older than the retention floor for a given period (period < 300s keeps 15 days, period < 3600s keeps 63 days, otherwise 455 days), so a short-period query over a long lookback (or a far-back `since`) previously left a silent gap and requested points AWS never returns. The effective start is now clamped per query period and a truncation is logged when the requested window was cut. The sync loop also inspects each series' `StatusCode`: it warns on `Forbidden` (a per-metric IAM gap that otherwise yields zero samples with no signal) and on `InternalError`, throwing a `TransientError` on `InternalError` so the host reschedules. The `latest` window margin was widened to cover late-arriving points, and a coarse `resources` gate skips the sync when a non-empty requested set matches none of the configured `${namespace}/${metric}` series.
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

- bee436f: Add `@rawdash/connector-aws-cloudwatch` (plus an internal `@rawdash/connector-aws-shared` package that holds the SigV4 signer and AWS Query XML parser for future AWS connectors; bundled into the cloudwatch dist via tsup `noExternal`, not a published dependency) — reads AWS CloudWatch metrics into the `metric` storage shape via `GetMetricData`. Users declare explicit metric queries (namespace, metric, statistic, period, dimensions); the connector batches up to 500 per call, follows `NextToken` pagination, and emits one sample per data point. Authenticates with either static `accessKeyId`/`secretAccessKey` or STS role assumption (`roleArn` + optional `externalId`), signing requests with AWS Signature V4 via the Web Crypto API (no AWS SDK dependency). Throttling maps to `RateLimitError`, access-denied to `AuthError`, and 5xx to `TransientError`.

### Patch Changes

- f0a0d0c: Fix the AWS connectors' build so their default export extends the real `@rawdash/core` `BaseConnector`. `@rawdash/connector-aws-shared` listed `@rawdash/core` as a devDependency, so tsup bundled a duplicate `BaseConnector` into its dist; the AWS connectors then inlined that duplicate, and the publish-time default-export check (which compares by prototype identity) failed. `@rawdash/core` is now kept external in the aws-shared build, so there is a single `BaseConnector` instance through the bundled base class.
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
