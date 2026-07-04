<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-aws-ses

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-aws-ses)](https://www.npmjs.com/package/@rawdash/connector-aws-ses)
[![license](https://img.shields.io/npm/l/@rawdash/connector-aws-ses)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Track Amazon SES transactional email volume, deliverability, and sender reputation as daily metric series, optionally split by configuration set.

## Install

```sh
npm install @rawdash/connector-aws-ses
```

## Authentication

SES publishes sending and reputation metrics to the AWS/SES CloudWatch namespace, so this connector reads CloudWatch rather than SES directly. Authenticate with either static IAM access keys or an assumed IAM role (STS). The principal needs `cloudwatch:GetMetricData` in the region your SES account sends from.

1. Create an IAM user or role with a policy granting `cloudwatch:GetMetricData`.
2. For static credentials, generate an access key ID and secret access key for that IAM user and store both halves as secrets, then reference them as `accessKeyId: secret("AWS_ACCESS_KEY_ID")` and `secretAccessKey: secret("AWS_SECRET_ACCESS_KEY")`.
3. For role assumption, set `roleArn` to the role to assume (and `externalId` if its trust policy requires one); the base credentials must be allowed to `sts:AssumeRole` it.
4. Set `region` to the AWS region your SES account sends from, e.g. `us-east-1`.
5. To break stats down by configuration set, add a CloudWatch event destination to each set in the SES console and list the set names under `configurationSets`. Open and click metrics require engagement tracking to be enabled on the set.

## Configuration

| Field               | Type   | Required | Description                                                                                                                                                                                                          |
| ------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `region`            | string | Yes      | The AWS region whose service endpoint you want to call, e.g. us-east-1.                                                                                                                                              |
| `accessKeyId`       | secret | No       | AWS access key ID for an IAM principal with permission to call the relevant service. Use together with the secret access key for static-credential auth.                                                             |
| `secretAccessKey`   | secret | No       | AWS secret access key paired with the access key ID above.                                                                                                                                                           |
| `roleArn`           | string | No       | IAM role to assume via STS instead of using static keys. The base credentials (the access key above, or the ambient AWS environment) must be allowed to sts:AssumeRole this role.                                    |
| `externalId`        | string | No       | External ID required by the trust policy of the role being assumed. Only used with Role ARN.                                                                                                                         |
| `configurationSets` | array  | No       | SES configuration set names to break email stats down by, in addition to the account-wide totals. Each set must publish its events to CloudWatch (via an event destination). Omit to track account-wide totals only. |
| `lookbackDays`      | number | No       | How many days of history to fetch on a full sync. Defaults to 30.                                                                                                                                                    |

## Resources

- **`ses_email_stats`** _(metric)_ - Daily Amazon SES sending funnel pulled from the AWS/SES CloudWatch namespace. One sample per (day, kind, configuration set); the sample value is the count for that kind. The kind dimension covers sends, deliveries, bounces, complaints, opens, and clicks.
  - Endpoint: `POST / (GetMetricData)`
  - Granularity: daily
  - Dimensions: `kind`, `configurationSet`, `stat`
  - Account-wide totals are always present; per-configuration-set, open, and click samples appear only when the relevant CloudWatch event destination and engagement tracking are configured. Each sync rewrites the samples for its window so finalized counts overwrite earlier ones.
- **`ses_reputation`** _(metric)_ - Daily account-wide SES sender reputation rates from the AWS/SES CloudWatch namespace. One sample per (day, kind); the value is the rate as a fraction between 0 and 1. The kind dimension is bounce_rate or complaint_rate.
  - Endpoint: `POST / (GetMetricData)`
  - Granularity: daily
  - Dimensions: `kind`, `stat`
  - Reputation rates are account-wide only and are not available per configuration set. Each sync rewrites the samples for its window.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const awsSes = {
  name: 'aws-ses',
  connectorId: 'aws-ses',
  config: {
    region: 'us-east-1',
    accessKeyId: secret('AWS_ACCESS_KEY_ID'),
    secretAccessKey: secret('AWS_SECRET_ACCESS_KEY'),
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [awsSes],
  dashboards: {
    email: defineDashboard({
      widgets: {
        sends_30d: {
          kind: 'stat',
          title: 'Emails sent (last 30d)',
          metric: defineMetric({
            connector: awsSes,
            shape: 'metric',
            name: 'ses_email_stats',
            fn: 'sum',
            filter: [
              { field: 'kind', op: 'eq', value: 'sends' },
              { field: 'configurationSet', op: 'eq', value: 'all' },
            ],
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

- Metrics are read from CloudWatch, so they reflect whatever SES publishes there; account-wide Send/Delivery/Bounce/Complaint are always available, while per-configuration-set, Open, and Click metrics require the matching CloudWatch event destination and engagement tracking.
- Reputation bounce and complaint rates are account-wide only; CloudWatch does not expose them per configuration set.
- A full sync uses lookbackDays (default 30); a latest sync refetches a short trailing window so finalized counts overwrite earlier estimates.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Amazon Web Services API docs](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-cloudwatch.html)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
