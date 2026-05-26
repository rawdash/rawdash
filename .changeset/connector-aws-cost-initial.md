---
'@rawdash/connector-aws-cost': minor
---

Add `@rawdash/connector-aws-cost`, a connector for AWS Cost Explorer. It syncs `daily_cost` (`GetCostAndUsage`) and `forecast` (`GetCostForecast`) into `metric` samples, supports `DAILY`/`MONTHLY` granularity and optional group-by (service, linked account, tag, cost category), and authenticates with a static access key/secret or a cross-account assumed role + external ID. Requests are signed with AWS SigV4 via WebCrypto so the connector runs on both Node and Cloudflare Workers.
