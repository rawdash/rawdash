<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-sendgrid

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-sendgrid)](https://www.npmjs.com/package/@rawdash/connector-sendgrid)
[![license](https://img.shields.io/npm/l/@rawdash/connector-sendgrid)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync daily SendGrid email stats (sends, delivery rate, bounce rate, spam complaints, opens, clicks) plus bounce and spam-report events for transactional-email dashboards.

## Install

```sh
npm install @rawdash/connector-sendgrid
```

## Authentication

A SendGrid Web API v3 key sent as a bearer token.

1. In SendGrid, open Settings -> API Keys and create a new API key.
2. Grant it at least read access to Stats and Suppressions (Restricted Access -> Stats: Read, Suppressions: Read), or use a Full Access key.
3. Store the key as a rawdash secret and reference it from config as `apiKey: secret("SENDGRID_API_KEY")`.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                                                                                                 |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`       | secret | Yes      | SendGrid Web API v3 key with read access to the Stats and Suppressions APIs. Create one under Settings -> API Keys.                                                                                                                         |
| `categories`   | array  | No       | Optional list of SendGrid categories to break email stats down by. When set, daily stats are fetched per category from the Category Stats endpoint; when omitted, account-wide global stats are fetched and tagged with the category "all". |
| `backfillDays` | number | No       | How many trailing days of email stats, bounces, and spam reports to pull on a full sync. Defaults to 90.                                                                                                                                    |
| `resources`    | array  | No       | Which SendGrid resources to sync. Omit to sync all of them.                                                                                                                                                                                 |

## Resources

- **`sendgrid_email_stats`** _(metric)_ - Daily email engagement stats (requests, delivered, bounces, spam reports, opens, clicks, unsubscribes) from the SendGrid Stats API, one sample per (day, category). The sample value is the number of requests (sends); every other counter is exposed as an attribute.
  - Endpoint: `GET /stats`
  - Unit: emails
  - Granularity: 1d
  - Dimensions: `category`, `requests`, `delivered`, `bounces`, `bounceDrops`, `blocks`, `deferred`, `invalidEmails`, `processed`, `opens`, `uniqueOpens`, `clicks`, `uniqueClicks`, `spamReports`, `spamReportDrops`, `unsubscribes`, `unsubscribeDrops`
  - Aggregated by day. The metric scope is cleared and rewritten on every sync because aggregate daily stats cannot be upserted by key. When categories are configured the Category Stats endpoint (GET /categories/stats) is used instead and the category dimension carries the category name.
- **`sendgrid_bounce`** _(event)_ - Bounce events from the SendGrid Suppressions API. One event per bounced address, timestamped at the bounce time.
  - Endpoint: `GET /suppression/bounces`
  - Paginated via limit / offset over the [start_time, end_time] window. Incremental syncs pull from the last sync time forward.
  - `email`: Recipient address that bounced.
  - `reason`: Reason reported by the receiving server.
  - `status`: SMTP status code for the bounce.
- **`sendgrid_spam_report`** _(event)_ - Spam-report (complaint) events from the SendGrid Suppressions API. One event per complaining address, timestamped at the report time.
  - Endpoint: `GET /suppression/spam_reports`
  - Paginated via limit / offset over the [start_time, end_time] window. Incremental syncs pull from the last sync time forward.
  - `email`: Recipient address that reported spam.
  - `ip`: Sending IP the complaint was attributed to.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const sendgrid = {
  name: 'sendgrid',
  connectorId: 'sendgrid',
  config: {
    apiKey: secret('SENDGRID_API_KEY'),
  },
};

export default defineConfig({
  connectors: [sendgrid],
  dashboards: {
    email: defineDashboard({
      widgets: {
        sends: {
          kind: 'stat',
          title: 'Emails sent (last 30d)',
          metric: defineMetric({
            connector: sendgrid,
            shape: 'metric',
            name: 'sendgrid_email_stats',
            field: 'requests',
            fn: 'sum',
          }),
        },
        bounces: {
          kind: 'stat',
          title: 'Bounces (last 30d)',
          metric: defineMetric({
            connector: sendgrid,
            shape: 'event',
            name: 'sendgrid_bounce',
            fn: 'count',
          }),
        },
        daily_volume: {
          kind: 'timeseries',
          title: 'Daily email volume',
          window: '30d',
          metric: defineMetric({
            connector: sendgrid,
            shape: 'metric',
            name: 'sendgrid_email_stats',
            field: 'requests',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

SendGrid returns X-RateLimit-Remaining / X-RateLimit-Reset response headers; the shared HTTP client backs off on 429 using the standard rate-limit policy.

## Limitations

- Email stats are a daily aggregate series: each sync clears the metric scope and rewrites the requested window, so incremental syncs only refresh the trailing window (default 2 days) while full syncs repopulate the whole backfill window.
- Category-level stats require the categories to be listed in config; SendGrid has no "all categories" stats call.
- Bounce and spam-report events are read from the Suppressions API and are limited to addresses still present in the suppression lists; entries removed from SendGrid are not retained.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [SendGrid API docs](https://docs.sendgrid.com/api-reference/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
