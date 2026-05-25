# @rawdash/connector-aws-cloudwatch

Rawdash connector for [AWS CloudWatch](https://docs.aws.amazon.com/cloudwatch/) — pulls the specific metric queries you declare into the `metric` storage shape via the [`GetMetricData`](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_GetMetricData.html) API.

CloudWatch is far too broad to mirror wholesale, so this connector takes a list of explicit **metric queries** (namespace + metric + statistic + period + dimensions) and emits one metric sample per returned data point. Requests are signed with AWS Signature V4 using the Web Crypto API — the package carries **no AWS SDK dependency**.

## Auth setup

Two mutually exclusive modes, selected by which fields you supply:

- **Static credentials** — `accessKeyId` + `secretAccessKey` for an IAM principal with the `cloudwatch:GetMetricData` permission. Create an access key under AWS Console → **IAM → Users → Security credentials**.
- **Role assumption** — `roleArn` (plus optional `externalId`). The connector calls STS `AssumeRole` to obtain temporary credentials, then signs CloudWatch with them. The _base_ credentials used for the `AssumeRole` call come from `accessKeyId`/`secretAccessKey` if provided, otherwise from the ambient AWS environment (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`) — the path rawdash cloud uses with its task role.

The role's trust policy must allow your base principal to `sts:AssumeRole`, and (if you set `externalId`) must require that external ID.

## Configuration

```ts
import { secret } from '@rawdash/core';

const cloudwatch = {
  name: 'cloudwatch',
  connectorId: 'aws-cloudwatch',
  config: {
    region: 'us-east-1',
    accessKeyId: secret('AWS_ACCESS_KEY_ID'),
    secretAccessKey: secret('AWS_SECRET_ACCESS_KEY'),
    // roleArn: 'arn:aws:iam::123456789012:role/rawdash-cloudwatch', // instead of static keys
    // externalId: 'rawdash',                                       // optional, with roleArn
    metricQueries: [
      {
        id: 'ec2_cpu',
        namespace: 'AWS/EC2',
        metric: 'CPUUtilization',
        stat: 'Average',
        periodSeconds: 300,
        dimensions: { InstanceId: 'i-0123456789abcdef0' },
      },
      {
        id: 'alb_5xx',
        namespace: 'AWS/ApplicationELB',
        metric: 'HTTPCode_Target_5XX_Count',
        stat: 'Sum',
        periodSeconds: 300,
      },
    ],
    // lookbackMinutes: 180, // optional — full-sync window when no `since` is supplied (default 180)
  },
};
```

Register the connector class when mounting the engine:

```ts
import { CloudWatchConnector } from '@rawdash/connector-aws-cloudwatch';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, {
  connectorRegistry: { 'aws-cloudwatch': CloudWatchConnector },
});
```

### Metric queries

Each entry of `metricQueries` becomes one [`MetricDataQuery`](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_MetricDataQuery.html):

| Field           | Notes                                                                               |
| --------------- | ----------------------------------------------------------------------------------- |
| `id`            | Must match `^[a-z][a-zA-Z0-9_]*$` (CloudWatch's query-id rule).                     |
| `namespace`     | e.g. `AWS/EC2`, `AWS/Lambda`, or a custom namespace.                                |
| `metric`        | The metric name within that namespace.                                              |
| `stat`          | Any CloudWatch statistic — `Average`, `Sum`, `Minimum`, `Maximum`, `p99`, etc.      |
| `periodSeconds` | Aggregation period, in seconds. Must be a multiple of 60 (minimum 1 minute).        |
| `dimensions`    | Optional `{ Name: Value }` map narrowing the metric (e.g. `{ InstanceId: 'i-…' }`). |

Queries are batched at most 500 per `GetMetricData` call, and `NextToken` pagination is followed automatically.

### Example dashboard

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [cloudwatch],
  dashboards: {
    infra: defineDashboard({
      widgets: {
        cpu: {
          kind: 'timeseries',
          title: 'EC2 CPU %',
          window: '24h',
          metric: defineMetric({
            connector: cloudwatch,
            shape: 'metric',
            name: 'AWS/EC2/CPUUtilization',
            fn: 'avg',
            window: '24h',
            groupBy: { field: 'ts', granularity: 'hour' },
          }),
        },
      },
    }),
  },
});
```

## Data model

| Storage shape | Metric name              | Value / attributes                                                                                                                      |
| ------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| metric        | `${namespace}/${metric}` | `value` = the data point for that period; attributes = the query's `dimensions` plus `stat`, `period`, `queryId`, `label`, `statusCode` |

Timestamps are stored as Unix epoch milliseconds. Data points with a non-finite value or unparseable timestamp are skipped.

## Schemas

`CloudWatchConnector.schemas.metric_data` is the Zod schema for the logical `GetMetricData` response (the connector parses the AWS Query-protocol XML into this shape). It powers the cloud shape-drift pipeline and the package's property tests.

## Sync behaviour

- **Window**: when the host supplies `since`, the connector fetches `[since, now]`. Otherwise a full sync uses `lookbackMinutes` (default 180) and a `latest` sync uses a short window covering the last few periods.
- **Idempotent**: every sync replaces the full set of samples for the metric names it owns (`storage.metrics(samples, { names })`), so re-syncing the same window converges.
- **Batched + paginated**: up to 500 queries per `GetMetricData` request, with `NextToken` followed until exhausted.
- **Single-call**: the windowed pull fits in one invocation, so `sync()` returns `{ done: true }` without a resume cursor.

## Errors

CloudWatch and STS return AWS error codes inside the response body even on a `400`, so the connector inspects the body and maps:

- `Throttling` / `RequestLimitExceeded` / `TooManyRequests` → `RateLimitError` — host backs off and reschedules.
- `AccessDenied` / `InvalidClientTokenId` / `SignatureDoesNotMatch` / `AuthFailure` → `AuthError` — host pauses until credentials are fixed.
- `5xx` → `TransientError` — host retries on the next tick.

## Out of scope

- **AWS Cost Explorer** — tracked separately.
- **CloudWatch Logs / Logs Insights** — a different API surface; deferred.

## Property tests

`src/property.test.ts` generates synthetic `GetMetricData` responses from the Zod schema, serializes them to the Query-protocol XML the connector parses, pipes them through `connector.sync()` against `InMemoryStorage`, and asserts universal invariants (finite metric values/timestamps, no `undefined` reaching storage, no throws) plus one metric sample per paired timestamp/value.
