<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-postmark

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-postmark)](https://www.npmjs.com/package/@rawdash/connector-postmark)
[![license](https://img.shields.io/npm/l/@rawdash/connector-postmark)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Postmark daily outbound email stats (sent, delivered, bounces, spam complaints, opens) and individual bounce records for transactional email deliverability dashboards.

## Install

```sh
npm install @rawdash/connector-postmark
```

## Authentication

A Postmark server API token. Each token is scoped to a single Postmark server and is sent in the X-Postmark-Server-Token header.

1. In the Postmark app, open the server you want to sync and go to the API Tokens tab.
2. Copy the Server API Token (it is a UUID). Each token is scoped to one server, so run one connector instance per Postmark server.
3. Store the token as a secret and reference it from config as `serverToken: secret("POSTMARK_SERVER_TOKEN")`.

## Configuration

| Field           | Type   | Required | Description                                                                                                                                                  |
| --------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `serverToken`   | secret | Yes      | A Postmark server API token (read access). Find it in the Postmark app under your server, on the API Tokens tab.                                             |
| `messageStream` | string | No       | Optional message stream id to scope stats and bounces to a single stream (e.g. `outbound`, `broadcast`). Omit to aggregate across all streams on the server. |
| `lookbackDays`  | number | No       | How many calendar days of stats and bounces to fetch on a full sync. Defaults to 90.                                                                         |
| `resources`     | array  | No       | Which Postmark resources to sync. Omit to sync all of them.                                                                                                  |

## Resources

- **`postmark_email_stats`** _(metric)_ - Daily outbound email stats per calendar day: sent (the metric value), plus delivered, bounce, spam-complaint, and open counters.
  - Endpoint: `GET /stats/outbound/{sends,bounces,spam,opens}`
  - Unit: emails
  - Granularity: day
  - Dimensions: `date`, `stream`
  - Measures: `delivered`, `bounced`, `hardBounces`, `softBounces`, `smtpApiErrors`, `transient`, `spamComplaints`, `opens`, `uniqueOpens`, `bounceRate`
  - Merges four Postmark outbound-stats endpoints (sends, bounces, spam, opens) keyed by date. The metric value is the daily sent count; delivered is sent minus total bounces clamped at zero.
- **`postmark_bounce`** _(event)_ - Individual bounce records (one event per bounce) timestamped at the bounce time, carrying type, recipient, stream, and activation state.
  - Endpoint: `GET /bounces`
  - Fetched over a rolling lookback window and rewritten on every sync, so resyncs are idempotent.
  - `bounceId`: Postmark bounce id.
  - `type`: Bounce type (e.g. HardBounce, Transient).
  - `typeCode`: Numeric bounce type code.
  - `email`: Recipient email address.
  - `from`: Sender address the bounce is for.
  - `tag`: Tag attached to the original message.
  - `messageStream`: Message stream id.
  - `messageId`: Original message id.
  - `serverId`: Postmark server id.
  - `subject`: Subject of the bounced message.
  - `name`: Human-readable bounce name.
  - `description`: Bounce description.
  - `inactive`: Whether the address was deactivated.
  - `canActivate`: Whether the address can be reactivated.
  - `dumpAvailable`: Whether the raw SMTP dump is available.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const postmark = {
  name: 'postmark',
  connectorId: 'postmark',
  config: {
    serverToken: secret('POSTMARK_SERVER_TOKEN'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [postmark],
  dashboards: {
    email: defineDashboard({
      widgets: {
        sent_30d: {
          kind: 'stat',
          title: 'Emails sent (30d)',
          window: '30d',
          metric: defineMetric({
            connector: postmark,
            shape: 'metric',
            name: 'postmark_email_stats',
            field: 'value',
            fn: 'sum',
          }),
        },
        daily_sent: {
          kind: 'timeseries',
          title: 'Daily emails sent',
          window: '30d',
          metric: defineMetric({
            connector: postmark,
            shape: 'metric',
            name: 'postmark_email_stats',
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

Postmark does not publish a fixed per-token request rate limit; the connector issues a small number of sequential requests per sync (four daily-stats endpoints plus paginated bounces) and relies on the shared HTTP client to honor 429 responses with backoff.

## Limitations

- Daily granularity only - stats are bucketed per calendar day in US Eastern Time (EST/EDT), matching Postmark stats API reporting.
- Delivered is derived as sent minus total bounces (hard, soft, SMTP API errors, and transient) for the day, clamped at zero, because Postmark does not expose a direct delivered counter.
- A server token is scoped to one Postmark server, so each connector instance covers a single server. Cross-server aggregation via an account token is out of scope.
- Bounce events are retained as a rolling window (lookbackDays) and rewritten on every sync; bounces older than the window age out. Stats history beyond the window is preserved across incremental syncs.
- The Postmark bounces API returns at most 10,000 records per query; the connector splits the lookback window into smaller date ranges to fetch them all, but a single day with more than 10,000 bounces cannot be fully retrieved.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Postmark API docs](https://postmarkapp.com/developer/api/overview)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
