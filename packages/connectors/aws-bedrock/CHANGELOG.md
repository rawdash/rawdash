# @rawdash/connector-aws-bedrock

## 0.23.0

### Patch Changes

- 9acb935: Add `@rawdash/connector-aws-bedrock` - syncs Bedrock model invocation counts, input/output tokens, average latency, and per-error-type counts per model from the CloudWatch `AWS/Bedrock` namespace, plus daily Bedrock spend per Cost Explorer USAGE_TYPE. Active model IDs are auto-discovered via CloudWatch ListMetrics on the AWS/Bedrock namespace (overridable through the `modelIds` config field). Authenticates either with static IAM access keys or with an assumed IAM role (Role ARN + optional External ID); requests are signed with AWS SigV4 via WebCrypto so the connector runs on both Node and Cloudflare Workers. CloudWatch calls hit the configured `region`; Cost Explorer always goes through its global us-east-1 endpoint. Backfill defaults to a trailing 30 days; incremental syncs use a short 3-day overlap.
- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0
