<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-onesignal

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-onesignal)](https://www.npmjs.com/package/@rawdash/connector-onesignal)
[![license](https://img.shields.io/npm/l/@rawdash/connector-onesignal)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync OneSignal push and messaging campaigns as entities and daily delivery stats as metrics to chart send volume, delivery rate, and conversions on a dashboard.

## Install

```sh
npm install @rawdash/connector-onesignal
```

## Authentication

A OneSignal REST API key plus the App ID it belongs to. The key is sent in the Authorization header as `Key <REST_API_KEY>` and every request is scoped to a single app via the app_id query parameter.

1. In the OneSignal dashboard open your app and go to Settings > Keys & IDs.
2. Copy the REST API Key and the App ID (a UUID). Each key is scoped to one app, so run one connector instance per OneSignal app.
3. Store the REST API Key as a secret and reference it from config as `apiKey: secret("ONESIGNAL_REST_API_KEY")`, and set `appId` to the App ID.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                                                                           |
| -------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`       | secret | Yes      | A OneSignal REST API key with read access to your app. Find it in the OneSignal dashboard under Settings > Keys & IDs.                                                                                                |
| `appId`        | string | Yes      | The OneSignal App ID (a UUID) the key belongs to. Find it alongside the REST API key under Settings > Keys & IDs.                                                                                                     |
| `lookbackDays` | number | No       | How many days of message history to page back through on a full sync. OneSignal lists notifications newest first, so the connector stops paging once it reaches notifications older than this window. Defaults to 90. |
| `resources`    | array  | No       | Which OneSignal resources to sync. Omit to sync all of them.                                                                                                                                                          |

## Resources

- **`onesignal_notification`** _(entity)_ - Push and messaging campaigns sent through OneSignal, each carrying its delivery counters (successful, failed, errored, converted, received), derived delivery and conversion rates, and queued/completed timestamps.
  - Endpoint: `GET /notifications`
  - Paged newest-first; full syncs stop at the lookback window and incremental syncs stop once a page predates the last sync. Counters reflect the delivery state captured at sync time.
  - `name`: Internal campaign/message name, if set.
  - `message`: Message body (English content when available).
  - `heading`: Message heading/title (English content when available).
  - `url`: Launch URL attached to the message.
  - `successful`: Number of recipients the message was delivered to.
  - `failed`: Number of recipients delivery failed for.
  - `errored`: Number of recipients that errored during send.
  - `converted`: Number of recipients that converted (clicked/opened).
  - `received`: Number of recipients confirmed to have received it.
  - `remaining`: Recipients still pending delivery, or null when done.
  - `recipients`: Total targeted recipients (successful + failed + errored).
  - `deliveryRate`: successful divided by recipients (0 when none targeted).
  - `conversionRate`: converted divided by successful (0 when none delivered).
  - `canceled`: Whether the message was canceled.
  - `queuedAt`: When the message was queued, in epoch milliseconds.
  - `sendAfter`: Scheduled send time, in epoch milliseconds, if scheduled.
  - `completedAt`: When sending completed, in epoch milliseconds.
- **`onesignal_notification_stats`** _(metric)_ - Daily messaging delivery stats bucketed by queued day: total recipients targeted (the metric value) plus delivered, failed, errored, converted, and received counters aggregated across all messages that day.
  - Endpoint: `GET /notifications`
  - Unit: sends
  - Granularity: day
  - Dimensions: `date`
  - Measures: `notifications`, `delivered`, `failed`, `errored`, `converted`, `received`, `deliveryRate`, `conversionRate`
  - Aggregated from the message list over the lookback window and rewritten per window on each sync, so resyncs are idempotent. The metric value is total targeted recipients (successful + failed + errored).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const onesignal = {
  name: 'onesignal',
  connectorId: 'onesignal',
  config: {
    apiKey: secret('ONESIGNAL_REST_API_KEY'),
    appId: '00000000-0000-0000-0000-000000000000',
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [onesignal],
  dashboards: {
    messaging: defineDashboard({
      widgets: {
        sends_7d: {
          kind: 'stat',
          title: 'Recipients targeted (7d)',
          window: '7d',
          metric: defineMetric({
            connector: onesignal,
            shape: 'metric',
            name: 'onesignal_notification_stats',
            field: 'value',
            fn: 'sum',
          }),
        },
        daily_delivered: {
          kind: 'timeseries',
          title: 'Delivered per day',
          window: '30d',
          metric: defineMetric({
            connector: onesignal,
            shape: 'metric',
            name: 'onesignal_notification_stats',
            field: 'delivered',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

OneSignal rate-limits the view endpoints to roughly 1 request/second per app and returns 429 with a Retry-After header when exceeded; the connector issues sequential paginated requests and relies on the shared HTTP client to honor 429 backoff.

## Limitations

- Daily stats are derived from the message list (each message carries its own successful, failed, converted, and received counters) rather than read from a dedicated analytics endpoint, and are bucketed by queued day in UTC.
- A REST API key is scoped to one OneSignal app, so each connector instance covers a single app. Cross-app aggregation is out of scope.
- Message counters reflect the delivery state as of the sync that captured the message. A message whose counters advance after it was first synced is revisited on incremental syncs only while it stays within the lookback window.
- Full syncs page newest-first until they reach the lookback window; message history older than the configured lookback is not backfilled.
- Subscriber (player) records and per-message outcome breakdowns are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [OneSignal API docs](https://documentation.onesignal.com/reference/rest-api-overview)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
