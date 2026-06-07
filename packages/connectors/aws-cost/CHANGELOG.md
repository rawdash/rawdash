# @rawdash/connector-aws-cost

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0

## 0.17.0

### Patch Changes

- @rawdash/core@0.17.0

## 0.16.0

### Minor Changes

- 1717d6f: Add `@rawdash/connector-aws-cost`, a connector for AWS Cost Explorer. It syncs `daily_cost` (`GetCostAndUsage`) and `forecast` (`GetCostForecast`) into `metric` samples, supports `DAILY`/`MONTHLY` granularity and optional group-by (service, linked account, tag, cost category), and authenticates with a static access key/secret or a cross-account assumed role + external ID. Requests are signed with AWS SigV4 via WebCrypto so the connector runs on both Node and Cloudflare Workers.

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
