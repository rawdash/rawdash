<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-mailgun

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-mailgun)](https://www.npmjs.com/package/@rawdash/connector-mailgun)
[![license](https://img.shields.io/npm/l/@rawdash/connector-mailgun)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync transactional email volume, delivery, bounce, and complaint metrics plus recent delivery events from Mailgun.

## Install

```sh
npm install @rawdash/connector-mailgun
```

## Authentication

A Mailgun API key with read access to analytics, sent via HTTP basic auth (username `api`, password is the key).

1. In the Mailgun dashboard open Settings -> API Keys and create or copy an API key with analytics read access.
2. Note which region hosts your domain (US or EU); set the connector `region` accordingly.
3. Store the key as a secret and reference it from the connector config as `apiKey: secret("MAILGUN_API_KEY")`, and set `domain` to the sending domain you want to report on.

## Configuration

| Field          | Type         | Required | Description                                                                                                      |
| -------------- | ------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `apiKey`       | secret       | Yes      | A Mailgun API key with read access to analytics. Create one in the Mailgun dashboard under Settings -> API Keys. |
| `domain`       | string       | Yes      | The Mailgun sending domain to report on (e.g. mg.example.com). Metrics and logs are filtered to this domain.     |
| `region`       | `us` \| `eu` | No       | Which Mailgun region hosts the domain. 'us' uses api.mailgun.net; 'eu' uses api.eu.mailgun.net.                  |
| `lookbackDays` | number       | No       | How many calendar days of stats/events to fetch on a full sync. Defaults to 90.                                  |
| `resources`    | array        | No       | Which Mailgun resources to sync. Omit to sync all of them.                                                       |

## Resources

- **`mailgun_email_stats`** _(metric)_ - Daily transactional email volume and engagement for the configured domain. The canonical value is `accepted` (messages accepted for sending); delivery, failure, and engagement counts are carried as measures.
  - Endpoint: `POST /v1/analytics/metrics`
  - Unit: emails
  - Granularity: day
  - Dimensions: `date`, `domain`
  - Measures: `delivered`, `failed`, `opened`, `clicked`, `unsubscribed`, `complained`
- **`mailgun_event`** _(event)_ - Recent per-message delivery events (accepted, delivered, failed, opened, clicked, unsubscribed, complained) for the configured domain. Deduplicated by Mailgun event id.
  - Endpoint: `POST /v1/analytics/logs`
  - A bounded sample of the most recent logs is stored; Mailgun retains log data for a limited period.
  - `eventId`: Mailgun event id (stable per event).
  - `eventType`: Event type (accepted, delivered, failed, opened, clicked, unsubscribed, complained).
  - `recipient`: Recipient email address.
  - `domain`: The Mailgun sending domain.
  - `severity`: Failure severity, when present.
  - `reason`: Failure reason, when present.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const mailgun = {
  name: 'mailgun',
  connectorId: 'mailgun',
  config: {
    apiKey: secret('MAILGUN_API_KEY'),
    domain: 'mg.example.com',
    region: 'us' as const,
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [mailgun],
  dashboards: {
    email: defineDashboard({
      widgets: {
        sends_30d: {
          kind: 'stat',
          title: 'Emails sent (30d)',
          window: '30d',
          metric: defineMetric({
            connector: mailgun,
            shape: 'metric',
            name: 'mailgun_email_stats',
            field: 'value',
            fn: 'sum',
          }),
        },
        daily_sends: {
          kind: 'timeseries',
          title: 'Daily email volume',
          window: '30d',
          metric: defineMetric({
            connector: mailgun,
            shape: 'metric',
            name: 'mailgun_email_stats',
            field: 'value',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Mailgun applies per-endpoint rate limits and returns 429 with a Retry-After header when exceeded; the shared HTTP client backs off and retries automatically.

## Limitations

- Metrics are reported at daily resolution; the connector requests `resolution=day` from the analytics API.
- Incremental syncs re-fetch a fixed trailing window and replace only that window, so older samples are preserved.
- The events resource stores a bounded sample of the most recent delivery logs (Mailgun retains log data for a limited period), not a complete event archive.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Mailgun API docs](https://documentation.mailgun.com/docs/mailgun/api-reference/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
