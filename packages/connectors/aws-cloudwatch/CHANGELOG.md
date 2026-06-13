# @rawdash/connector-aws-cloudwatch

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
