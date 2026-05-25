---
'@rawdash/connector-aws-cloudwatch': minor
---

Add `@rawdash/connector-aws-cloudwatch` — reads AWS CloudWatch metrics into the `metric` storage shape via `GetMetricData`. Users declare explicit metric queries (namespace, metric, statistic, period, dimensions); the connector batches up to 500 per call, follows `NextToken` pagination, and emits one sample per data point. Authenticates with either static `accessKeyId`/`secretAccessKey` or STS role assumption (`roleArn` + optional `externalId`), signing requests with AWS Signature V4 via the Web Crypto API (no AWS SDK dependency). Throttling maps to `RateLimitError`, access-denied to `AuthError`, and 5xx to `TransientError`.
