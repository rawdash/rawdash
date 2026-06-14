# @rawdash/connector-aws-bedrock

## 0.25.0

### Patch Changes

- 8315556: Clamp the CloudWatch metric window to CloudWatch's period-based retention floor and classify Cost Explorer rate-limit throttles. CloudWatch returns no GetMetricData points older than the retention floor for a given period (period < 300s keeps 15 days, < 3600s keeps 63 days, otherwise 455 days), so a short `granularitySeconds` over a long `lookbackDays` (or a far-back `since`) previously left a silent gap and requested points AWS never returns. `getBedrockWindow` now clamps the effective start to the retention floor for the configured period and logs a truncation when the requested window was cut; the defaults (86400s period, 30-day lookback) are unaffected. The Cost Explorer error mapping now treats `LimitExceeded`/`LimitExceededException` (the Cost Explorer request-rate throttle, returned as HTTP 400) as a retryable rate-limit error so it is backed off and retried instead of failing the sync. Non-`Complete` GetMetricData result statuses are now logged, and the `since` parsing in `getSpendWindow` is aligned with `getBedrockWindow`.
- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0

## 0.23.0

### Patch Changes

- 9acb935: Add `@rawdash/connector-aws-bedrock` - syncs Bedrock model invocation counts, input/output tokens, average latency, and per-error-type counts per model from the CloudWatch `AWS/Bedrock` namespace, plus daily Bedrock spend per Cost Explorer USAGE_TYPE. Active model IDs are auto-discovered via CloudWatch ListMetrics on the AWS/Bedrock namespace (overridable through the `modelIds` config field). Authenticates either with static IAM access keys or with an assumed IAM role (Role ARN + optional External ID); requests are signed with AWS SigV4 via WebCrypto so the connector runs on both Node and Cloudflare Workers. CloudWatch calls hit the configured `region`; Cost Explorer always goes through its global us-east-1 endpoint. Backfill defaults to a trailing 30 days; incremental syncs use a short 3-day overlap.
- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0
