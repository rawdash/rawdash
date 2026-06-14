<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-aws-cloudwatch

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-aws-cloudwatch)](https://www.npmjs.com/package/@rawdash/connector-aws-cloudwatch)
[![license](https://img.shields.io/npm/l/@rawdash/connector-aws-cloudwatch)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Pull declared CloudWatch metric time series (any namespace, statistic, and period) into a single metric series per query.

> **Cost & frequency.** CloudWatch GetMetricData is billed per metric requested on the paid tier; high-frequency syncs over many metrics add up.

## Install

```sh
npm install @rawdash/connector-aws-cloudwatch
```

## Authentication

Authenticate with either static IAM access keys or an assumed IAM role (STS). The principal needs cloudwatch:GetMetricData on the target region.

1. Create an IAM user or role with a policy granting `cloudwatch:GetMetricData`.
2. For static credentials, generate an access key ID and secret access key for that IAM user and store them as secrets.
3. For role assumption, set `roleArn` to the role to assume (and `externalId` if its trust policy requires one); the base credentials must be allowed to `sts:AssumeRole` it.
4. Set `region` to the AWS region whose CloudWatch endpoint holds the metrics, e.g. `us-east-1`.
5. Reference the keys from config, e.g. `accessKeyId: secret("AWS_ACCESS_KEY_ID")` and `secretAccessKey: secret("AWS_SECRET_ACCESS_KEY")`.

## Configuration

| Field             | Type   | Required | Description                                                                                                                                                                                                   |
| ----------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `region`          | string | Yes      | The AWS region whose service endpoint you want to call, e.g. us-east-1.                                                                                                                                       |
| `accessKeyId`     | secret | No       | AWS access key ID for an IAM principal with permission to call the relevant service. Use together with the secret access key for static-credential auth.                                                      |
| `secretAccessKey` | secret | No       | AWS secret access key paired with the access key ID above.                                                                                                                                                    |
| `roleArn`         | string | No       | IAM role to assume via STS instead of using static keys. The base credentials (the access key above, or the ambient AWS environment) must be allowed to sts:AssumeRole this role.                             |
| `externalId`      | string | No       | External ID required by the trust policy of the role being assumed. Only used with Role ARN.                                                                                                                  |
| `metricQueries`   | array  | Yes      | CloudWatch is too broad to mirror wholesale; declare the specific metrics to pull. Each query needs an id, namespace, metric name, statistic, and period (seconds, multiple of 60), with optional dimensions. |
| `lookbackMinutes` | number | No       | How far back to pull data points on a full sync when the host does not supply a since bound. Defaults to 180.                                                                                                 |

## Resources

- **`<namespace>/<metric>`** _(metric)_ - One metric series per declared metric query. The series name is the query namespace/metric (e.g. `AWS/EC2/CPUUtilization`), so the actual keys depend on the configured `metricQueries`. Each sample carries the query statistic, period, query id, the upstream status code, and label as attributes.
  - Endpoint: `POST / (GetMetricData)`
  - Granularity: Per query period (periodSeconds, a multiple of 60)
  - Dimensions: `stat`, `period`, `queryId`, `statusCode`, `label`
  - Each sync replaces the full set of samples for the metric names it owns (idempotent).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const cloudwatch = {
  name: 'cloudwatch',
  connectorId: 'aws-cloudwatch',
  config: {
    region: 'us-east-1',
    accessKeyId: secret('AWS_ACCESS_KEY_ID'),
    secretAccessKey: secret('AWS_SECRET_ACCESS_KEY'),
    metricQueries: [
      {
        id: 'ec2_cpu',
        namespace: 'AWS/EC2',
        metric: 'CPUUtilization',
        stat: 'Average',
        periodSeconds: 300,
        dimensions: { InstanceId: 'i-0123456789abcdef0' },
      },
    ],
  },
};

export default defineConfig({
  connectors: [cloudwatch],
  dashboards: {
    infra: defineDashboard({
      widgets: {
        cpu: {
          kind: 'timeseries',
          title: 'EC2 CPU Utilization',
          window: '24h',
          metric: defineMetric({
            connector: cloudwatch,
            shape: 'metric',
            name: 'AWS/EC2/CPUUtilization',
            fn: 'avg',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

GetMetricData is batched at most 500 metrics per call with NextToken pagination; throttling (Throttling / RequestLimitExceeded / TooManyRequests) is retried with backoff.

## Limitations

- CloudWatch is too broad to mirror wholesale; only the metrics declared in `metricQueries` are synced; there is no automatic metric discovery.
- The series name is derived from the query namespace/metric, so two queries against the same metric with different statistics or dimensions share one series name and are distinguished only by sample attributes.
- Each query period must be a multiple of 60 seconds; sub-minute resolution is not supported.
- A full sync uses lookbackMinutes; a latest sync uses a short window covering the last few periods.
- Each query's window is clamped to CloudWatch's resolution-based retention floor (period < 300s keeps 15 days, < 3600s keeps 63 days, otherwise 455 days), since GetMetricData returns no points older than the floor; truncation is logged.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Amazon Web Services API docs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_GetMetricData.html)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
