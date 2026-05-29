# @rawdash/connector-aws-cost

Rawdash connector for [AWS Cost Explorer](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/Welcome.html) — syncs daily/monthly spend and cost forecasts into the six-shape storage model, optionally broken down by service, linked account, or tag.

> **Cost note:** every Cost Explorer query is billed at **$0.01** by AWS. This connector's defaults are deliberately conservative — a single daily sync issues two queries (`GetCostAndUsage` + `GetCostForecast`). Keep the sync interval at a day (the minimum sensible cadence is 1 hour) and prefer `MONTHLY` granularity for long windows.

## Auth setup

Cost Explorer must be queried from the **management (payer) account**, or from a member account that has been granted explicit Cost Explorer access. The connector uses the same auth shape as `@rawdash/connector-aws-cloudwatch`: a static access key/secret, optionally combined with a cross-account role to assume.

### Option A — Access key + secret

1. In the AWS console open **IAM → Users** and create (or pick) a programmatic user.
2. Attach a policy granting `ce:GetCostAndUsage` and `ce:GetCostForecast` (the managed `AWSBillingReadOnlyAccess` policy is sufficient).
3. Create an access key for the user and store the two halves as the secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

### Option B — Cross-account role assumption

1. In the **management account**, create a role (e.g. `rawdash-cost-explorer`) with the Cost Explorer permissions above and a trust policy allowing your base principal to assume it. Require an **external ID** to guard against the confused-deputy problem.
2. Provide `roleArn` and the matching `externalId`, plus a base access key/secret that is allowed to call `sts:AssumeRole` on that role.

The connector calls `sts:AssumeRole`, then signs Cost Explorer requests with the returned temporary credentials.

## Configuration

```ts
import { secret } from '@rawdash/core';

const awsCost = {
  name: 'aws-cost',
  connectorId: 'aws-cost',
  config: {
    accessKeyId: secret('AWS_ACCESS_KEY_ID'),
    secretAccessKey: secret('AWS_SECRET_ACCESS_KEY'),
    granularity: 'DAILY', // or 'MONTHLY'
    groupBy: ['SERVICE'], // optional — up to two dimensions
    lookbackDays: 90, // optional backfill window, defaults to 90
  },
};
```

Cross-account variant:

```ts
const awsCost = {
  name: 'aws-cost',
  connectorId: 'aws-cost',
  config: {
    accessKeyId: secret('AWS_ACCESS_KEY_ID'),
    secretAccessKey: secret('AWS_SECRET_ACCESS_KEY'),
    roleArn: 'arn:aws:iam::123456789012:role/rawdash-cost-explorer',
    externalId: 'rawdash-cost-explorer',
    groupBy: ['LINKED_ACCOUNT', 'TAG:Environment'],
  },
};
```

`groupBy` accepts Cost Explorer dimension keys (`SERVICE`, `LINKED_ACCOUNT`, `REGION`, …), tag keys prefixed with `TAG:` (e.g. `TAG:Environment`), or cost categories prefixed with `COST_CATEGORY:`. Cost Explorer allows at most two group-by keys; extras are ignored.

Register the connector class when mounting the engine:

```ts
import { AwsCostConnector } from '@rawdash/connector-aws-cost';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, {
  connectorRegistry: { 'aws-cost': AwsCostConnector },
});
```

Then wire it into `defineConfig`:

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [awsCost],
  dashboards: {
    spend: defineDashboard({
      widgets: {
        cost_today: {
          kind: 'stat',
          title: 'Spend today',
          metric: defineMetric({
            connector: awsCost,
            shape: 'metric',
            name: 'aws_cost_daily',
            fn: 'sum',
            window: '1d',
          }),
        },
        cost_over_time: {
          kind: 'timeseries',
          title: 'Daily spend',
          window: '30d',
          metric: defineMetric({
            connector: awsCost,
            shape: 'metric',
            name: 'aws_cost_daily',
            fn: 'sum',
            window: '30d',
            groupBy: { field: 'ts', granularity: 'day' },
          }),
        },
        forecast: {
          kind: 'stat',
          title: 'Forecast (this month)',
          metric: defineMetric({
            connector: awsCost,
            shape: 'metric',
            name: 'aws_cost_forecast',
            fn: 'latest',
          }),
        },
      },
    }),
  },
});
```

## Data model

All resources are stored as **metric samples** (`shape: 'metric'`). The `ts` field is the start of each cost period in Unix milliseconds and `value` is the unblended cost amount.

| Metric name         | Source resource | `value`              | Attributes                                                     |
| ------------------- | --------------- | -------------------- | -------------------------------------------------------------- |
| `aws_cost_daily`    | `daily_cost`    | unblended cost       | `granularity`, `unit`, `estimated`, plus one per `groupBy` key |
| `aws_cost_forecast` | `forecast`      | forecasted mean cost | `granularity`, `unit`, `lowerBound`, `upperBound`              |

When `groupBy` is set, each group becomes its own sample with the dimension value stored under a normalized attribute name (`SERVICE` → `service`, `LINKED_ACCOUNT` → `linked_account`, `TAG:Environment` → `tag_Environment`).

## Schemas

`AwsCostConnector.schemas` declares the Zod schema for each `request()` resource. Used by the cloud shape-drift pipeline to populate `connector_baselines`, and by the package's property tests.

| Resource     | Represents                                                               |
| ------------ | ------------------------------------------------------------------------ |
| `daily_cost` | `GetCostAndUsage` — per-period unblended cost, optionally grouped        |
| `forecast`   | `GetCostForecast` — forecasted unblended cost for the upcoming period(s) |

## Sync behaviour

- **Backfill** (`mode: 'full'`): fetches a rolling window (default 90 days, configurable via `lookbackDays`) of `daily_cost`, plus the upcoming forecast.
- **Incremental** (`mode: 'latest'`): fetches only the trailing 3 days, since Cost Explorer data can be revised for a couple of days after the fact.
- Both modes **clear existing metric data** for each resource before re-inserting, preventing duplicate rows across sync runs.
- **Pagination**: `GetCostAndUsage` is drained via `NextPageToken`. Interrupted syncs return a cursor and resume from the same phase and window.
- **Endpoint/region**: Cost Explorer is global and is always reached through `ce.us-east-1.amazonaws.com`, signed against `us-east-1` regardless of where your resources run.
- **Errors**: `ThrottlingException` → `RateLimitError` (host backs off), `AccessDenied`/auth failures → `AuthError`, 5xx → `TransientError`. A `DataUnavailableException` from the forecast API (typical for brand-new accounts) is treated as "no forecast" rather than a hard failure.
