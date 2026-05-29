<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-aws-cost

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-aws-cost)](https://www.npmjs.com/package/@rawdash/connector-aws-cost)
[![license](https://img.shields.io/npm/l/@rawdash/connector-aws-cost)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Track AWS spend over time and projected month-end costs, optionally broken down by service, account, tag, or cost category.

> **Cost & frequency.** Each AWS Cost Explorer query is billed $0.01; avoid syncing more often than necessary. Recommended sync interval: **1 day**. Minimum sensible interval: **1 hour**. Each sync costs roughly: 2 Cost Explorer queries (about $0.02).

## Install

```sh
npm install @rawdash/connector-aws-cost
```

## Authentication

Authenticate either with a long-lived IAM access key pair or by assuming an IAM role (Role ARN with an optional External ID). The principal needs the `ce:GetCostAndUsage` and `ce:GetCostForecast` permissions. Cost Explorer is a global service reached through its us-east-1 endpoint.

1. In the AWS console, create an IAM user or role granting `ce:GetCostAndUsage` and `ce:GetCostForecast`.
2. For access-key auth, generate an access key pair and store both halves as secrets, then reference them as `accessKeyId: secret("AWS_ACCESS_KEY_ID")` and `secretAccessKey: secret("AWS_SECRET_ACCESS_KEY")`.
3. For role-assumption auth, set `roleArn` to the role to assume and (if configured) `externalId` to the role’s expected external ID.
4. Cost Explorer must be enabled for the account; the first activation can take up to 24 hours before data is queryable.

## Configuration

| Field             | Type                 | Required | Description                                                                                                                                                                       |
| ----------------- | -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accessKeyId`     | secret               | No       | AWS access key ID for an IAM principal with permission to call the relevant service. Use together with the secret access key for static-credential auth.                          |
| `secretAccessKey` | secret               | No       | AWS secret access key paired with the access key ID above.                                                                                                                        |
| `roleArn`         | string               | No       | IAM role to assume via STS instead of using static keys. The base credentials (the access key above, or the ambient AWS environment) must be allowed to sts:AssumeRole this role. |
| `externalId`      | string               | No       | External ID required by the trust policy of the role being assumed. Only used with Role ARN.                                                                                      |
| `granularity`     | `DAILY` \| `MONTHLY` | No       | Time granularity of cost buckets. DAILY (default) or MONTHLY. Each Cost Explorer query is billed at $0.01, so MONTHLY is cheaper over long windows.                               |
| `groupBy`         | array                | No       | Up to two Cost Explorer dimensions to break costs down by, e.g. SERVICE, LINKED_ACCOUNT, or TAG:Environment. Omit for total cost only.                                            |
| `lookbackDays`    | number               | No       | How many days of history to fetch on a full sync. Defaults to 90.                                                                                                                 |

## Resources

- **`aws_cost_daily`** _(metric)_ - Historical unblended AWS cost per time bucket, optionally split across the configured group-by dimensions. The current bucket is estimated and overwritten on later syncs as it finalizes.
  - Endpoint: `POST GetCostAndUsage`
  - Unit: USD
  - Granularity: daily
  - Dimensions: `granularity`, `estimated`, `unit`, `service`
  - Prefer MONTHLY granularity over long windows since each Cost Explorer query is billed. Cost Explorer accepts at most two group-by dimensions per query.
- **`aws_cost_forecast`** _(metric)_ - Projected future unblended AWS cost (mean value) with optional lower and upper prediction-interval bounds. Empty when the account has insufficient history to forecast.
  - Endpoint: `POST GetCostForecast`
  - Unit: USD
  - Granularity: daily
  - Dimensions: `granularity`, `unit`, `lowerBound`, `upperBound`
  - Prefer MONTHLY granularity over long windows since each Cost Explorer query is billed.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const awsCost = {
  name: 'aws-cost',
  connectorId: 'aws-cost',
  config: {
    accessKeyId: secret('AWS_ACCESS_KEY_ID'),
    secretAccessKey: secret('AWS_SECRET_ACCESS_KEY'),
    granularity: 'DAILY',
    groupBy: ['SERVICE'],
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [awsCost],
  dashboards: {
    finance: defineDashboard({
      widgets: {
        spend_by_service: {
          kind: 'stat',
          title: 'Total spend (last 30d)',
          metric: defineMetric({
            connector: awsCost,
            shape: 'metric',
            name: 'aws_cost_daily',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Cost Explorer throttling (ThrottlingException) is retried with backoff. Cost Explorer is global and always reached via ce.us-east-1.amazonaws.com.

## Limitations

- Cost Explorer data can be revised for a couple of days after the fact, so incremental syncs refetch a short trailing window.
- Forecast is unavailable for brand-new accounts (DataUnavailableException is treated as no forecast, not an error).

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Amazon Web Services API docs](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_Operations_AWS_Cost_Explorer_Service.html)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
