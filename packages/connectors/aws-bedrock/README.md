<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-aws-bedrock

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-aws-bedrock)](https://www.npmjs.com/package/@rawdash/connector-aws-bedrock)
[![license](https://img.shields.io/npm/l/@rawdash/connector-aws-bedrock)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Track Bedrock model invocations, input/output tokens, latency, errors, and spend per Bedrock-hosted model.

> **Cost & frequency.** Each AWS Cost Explorer query is billed $0.01, and CloudWatch GetMetricData is billed per metric requested. High-frequency syncs across many models add up. Recommended sync interval: **1 day**. Minimum sensible interval: **1 hour**. Each sync costs roughly: 1 Cost Explorer query (about $0.01) plus CloudWatch GetMetricData.

## Install

```sh
npm install @rawdash/connector-aws-bedrock
```

## Authentication

Authenticate with either static IAM access keys or an assumed IAM role (STS). The principal needs cloudwatch:ListMetrics and cloudwatch:GetMetricData on the target region for invocation and error metrics, and ce:GetCostAndUsage on the Cost Explorer (us-east-1) endpoint for spend.

1. Create an IAM user or role with a policy granting `cloudwatch:ListMetrics`, `cloudwatch:GetMetricData`, and `ce:GetCostAndUsage`.
2. For static credentials, generate an access key ID and secret access key for that IAM user and store them as secrets.
3. For role assumption, set `roleArn` to the role to assume (and `externalId` if its trust policy requires one); the base credentials must be allowed to `sts:AssumeRole` it.
4. Set `region` to the AWS region where the Bedrock invocations are running, e.g. `us-east-1` or `us-west-2`. Cost Explorer is always reached through its global us-east-1 endpoint.
5. Reference the keys from config, e.g. `accessKeyId: secret("AWS_ACCESS_KEY_ID")` and `secretAccessKey: secret("AWS_SECRET_ACCESS_KEY")`.

## Configuration

| Field                | Type   | Required | Description                                                                                                                                                                                                     |
| -------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `region`             | string | Yes      | The AWS region whose service endpoint you want to call, e.g. us-east-1.                                                                                                                                         |
| `accessKeyId`        | secret | No       | AWS access key ID for an IAM principal with permission to call the relevant service. Use together with the secret access key for static-credential auth.                                                        |
| `secretAccessKey`    | secret | No       | AWS secret access key paired with the access key ID above.                                                                                                                                                      |
| `roleArn`            | string | No       | IAM role to assume via STS instead of using static keys. The base credentials (the access key above, or the ambient AWS environment) must be allowed to sts:AssumeRole this role.                               |
| `externalId`         | string | No       | External ID required by the trust policy of the role being assumed. Only used with Role ARN.                                                                                                                    |
| `modelIds`           | array  | No       | Restrict the sync to specific Bedrock model IDs (e.g. anthropic.claude-3-sonnet-20240229-v1:0). When omitted, the connector discovers active model IDs via CloudWatch ListMetrics on the AWS/Bedrock namespace. |
| `lookbackDays`       | number | No       | How many days of history to fetch on a full sync. Defaults to 30.                                                                                                                                               |
| `granularitySeconds` | number | No       | Aggregation period for CloudWatch metric samples (multiple of 60). Defaults to 86400 (one day per sample).                                                                                                      |

## Resources

- **`bedrock_invocations`** _(metric)_ - Number of Bedrock model invocations per period and model. One sample per (timestamp, modelId).
  - Endpoint: `POST / (GetMetricData / AWS/Bedrock Invocations)`
  - Granularity: Configurable, defaults to daily (86400s)
  - Dimensions: `modelId`, `period`, `statusCode`
  - Sourced from the CloudWatch AWS/Bedrock namespace, statistic Sum, grouped by the ModelId dimension.
- **`bedrock_input_tokens`** _(metric)_ - Bedrock input tokens billed per period and model (CloudWatch InputTokenCount, statistic Sum).
  - Endpoint: `POST / (GetMetricData / AWS/Bedrock InputTokenCount)`
  - Granularity: Configurable, defaults to daily (86400s)
  - Dimensions: `modelId`, `period`, `statusCode`
- **`bedrock_output_tokens`** _(metric)_ - Bedrock output tokens generated per period and model (CloudWatch OutputTokenCount, statistic Sum).
  - Endpoint: `POST / (GetMetricData / AWS/Bedrock OutputTokenCount)`
  - Granularity: Configurable, defaults to daily (86400s)
  - Dimensions: `modelId`, `period`, `statusCode`
- **`bedrock_invocation_latency_ms`** _(metric)_ - Average Bedrock invocation latency per period and model (CloudWatch InvocationLatency, statistic Average).
  - Endpoint: `POST / (GetMetricData / AWS/Bedrock InvocationLatency)`
  - Unit: milliseconds
  - Granularity: Configurable, defaults to daily (86400s)
  - Dimensions: `modelId`, `period`, `statusCode`
- **`bedrock_errors`** _(metric)_ - Bedrock invocation error count per period, model, and error type (CloudWatch InvocationClientErrors / InvocationServerErrors / InvocationThrottles, statistic Sum).
  - Endpoint: `POST / (GetMetricData / AWS/Bedrock Invocation*Errors)`
  - Granularity: Configurable, defaults to daily (86400s)
  - Dimensions: `modelId`, `errorType`, `period`
- **`bedrock_spend`** _(metric)_ - Unblended AWS Bedrock spend per day, grouped by Cost Explorer USAGE_TYPE. Bedrock cost is split across input/output tokens and on-demand vs. provisioned throughput rather than by raw modelId.
  - Endpoint: `POST GetCostAndUsage (Cost Explorer, filtered to Amazon Bedrock)`
  - Unit: USD
  - Granularity: daily
  - Dimensions: `usageType`, `estimated`, `unit`
  - Each Cost Explorer query is billed $0.01. Current-day spend is reported as estimated and is overwritten on later syncs as it finalizes.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const bedrock = {
  name: 'bedrock',
  connectorId: 'aws-bedrock',
  config: {
    region: 'us-east-1',
    accessKeyId: secret('AWS_ACCESS_KEY_ID'),
    secretAccessKey: secret('AWS_SECRET_ACCESS_KEY'),
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [bedrock],
  dashboards: {
    ai: defineDashboard({
      widgets: {
        spend_mtd: {
          kind: 'stat',
          title: 'Bedrock spend (last 30d)',
          metric: defineMetric({
            connector: bedrock,
            shape: 'metric',
            name: 'bedrock_spend',
            fn: 'sum',
          }),
        },
        invocations_trend: {
          kind: 'timeseries',
          title: 'Invocations per day',
          window: '30d',
          metric: defineMetric({
            connector: bedrock,
            shape: 'metric',
            name: 'bedrock_invocations',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

CloudWatch GetMetricData batches up to 500 queries per call and follows NextToken pagination; Cost Explorer queries are billed at $0.01 each. Throttling (Throttling / ThrottlingException / TooManyRequests) is retried with backoff.

## Limitations

- CloudWatch metrics for Bedrock are only emitted for models that have been invoked; ListMetrics only returns models with activity in roughly the last 14 days.
- Cost Explorer does not expose a native modelId dimension; spend is grouped by USAGE_TYPE (e.g. inference input/output tokens per model), and the model identifier is embedded in the usage_type string.
- Each Cost Explorer query is billed $0.01; a full sync issues one GetCostAndUsage call (plus pagination).
- A full sync uses lookbackDays; a latest sync uses a trailing window covering the last few periods plus a short Cost Explorer overlap.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Amazon Web Services API docs](https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-cw.html)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
