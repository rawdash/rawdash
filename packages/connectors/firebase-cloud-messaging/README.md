<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-firebase-cloud-messaging

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-firebase-cloud-messaging)](https://www.npmjs.com/package/@rawdash/connector-firebase-cloud-messaging)
[![license](https://img.shields.io/npm/l/@rawdash/connector-firebase-cloud-messaging)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Track push-notification volume and delivery over time from the Firebase Cloud Messaging -> BigQuery delivery export: daily sends, delivery rate, and per-topic breakdown.

## Install

```sh
npm install @rawdash/connector-firebase-cloud-messaging
```

## Authentication

Authenticate against the BigQuery API with a Google service account JSON key. The service account needs the BigQuery Data Viewer role on the FCM delivery export dataset and the BigQuery Job User role on the project that runs the queries.

1. Enable the Firebase Cloud Messaging -> BigQuery delivery data export in the Firebase console (Engage -> Messaging -> ... -> BigQuery export, or Project Settings -> Integrations -> BigQuery). This is a manual one-time setup per project; data starts flowing into the firebase_messaging dataset within a day.
2. Create a service account at Google Cloud -> IAM & Admin -> Service Accounts in the same project (or grant an existing one access).
3. Grant the service account roles/bigquery.dataViewer on the messaging dataset (so it can read the export table) and roles/bigquery.jobUser on the project (so it can run query jobs).
4. Generate a JSON key for the service account and store its contents as a secret (e.g. FIREBASE_SA_JSON).
5. Reference the key from config as serviceAccountJson: secret("FIREBASE_SA_JSON") and set projectId to the Firebase project that owns the export.

## Configuration

| Field                | Type   | Required | Description                                                                                                                                                                                        |
| -------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serviceAccountJson` | secret | Yes      | Contents of the JSON key file for a Google service account with the role required by this connector. Create one at Google Cloud -> IAM & Admin -> Service Accounts and store the JSON as a secret. |
| `projectId`          | string | Yes      | Project that hosts the Firebase Cloud Messaging -> BigQuery delivery export (also the project used to bill the BigQuery queries this connector runs).                                              |
| `bqDataset`          | string | No       | BigQuery dataset containing the FCM delivery export table. Defaults to firebase_messaging (the default name Firebase uses when you enable the export).                                             |
| `bqLocation`         | string | No       | Region or multi-region of the messaging dataset (e.g. US, EU, us-central1). Defaults to US.                                                                                                        |
| `lookbackDays`       | number | No       | How many days of history to query on a full sync. Defaults to 90.                                                                                                                                  |
| `topTopicsLimit`     | number | No       | How many topics to retain per day for the per-topic metric, ranked by accepted message count. Defaults to 100.                                                                                     |

## Resources

- **`messages_per_day`** _(metric)_ - Daily push-notification volume per (date, platform): messages accepted (sent), messages delivered, and the approximate delivery rate. One sample per day per platform present in the FCM delivery export.
  - Endpoint: `POST /bigquery/v2/projects/{projectId}/queries`
  - Unit: messages
  - Granularity: daily
  - Dimensions: `platform`, `delivered`, `delivery_rate`
  - value is the count of MESSAGE_ACCEPTED events (sends). The trailing 2 days are always refetched on incremental syncs to pick up streamed rows.
- **`messages_per_topic`** _(metric)_ - Daily push-notification volume per (date, topic) for topic sends: messages accepted (sent), messages delivered, and the approximate delivery rate. One sample per day per topic, capped at topTopicsLimit topics per day ranked by accepted count.
  - Endpoint: `POST /bigquery/v2/projects/{projectId}/queries`
  - Unit: messages
  - Granularity: daily
  - Dimensions: `topic`, `delivered`, `delivery_rate`
  - value is the count of MESSAGE_ACCEPTED events (sends) for the topic. Only messages with a non-empty topic are counted; direct token and device-group sends are excluded.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const messaging = {
  name: 'messaging',
  connectorId: 'firebase-cloud-messaging',
  config: {
    serviceAccountJson: secret('FIREBASE_SA_JSON'),
    projectId: 'my-firebase-project',
    bqDataset: 'firebase_messaging',
    bqLocation: 'US',
    lookbackDays: 90,
    topTopicsLimit: 100,
  },
};

export default defineConfig({
  connectors: [messaging],
  dashboards: {
    messaging: defineDashboard({
      widgets: {
        sends: {
          kind: 'stat',
          title: 'Push sends (last 7d)',
          metric: defineMetric({
            connector: messaging,
            shape: 'metric',
            name: 'messages_per_day',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

BigQuery jobs.query is rate-limited per project; standard 429 / RESOURCE_EXHAUSTED responses are retried with backoff. Each connector sync runs one query per resource.

## Limitations

- Requires the Firebase Cloud Messaging -> BigQuery delivery export to be configured in the Firebase console; that step is manual and one-time per project, and only days after the configuration date are present in the export.
- Reads the firebase_messaging.data delivery table. Sends are counted from MESSAGE_ACCEPTED rows and deliveries from MESSAGE_DELIVERED rows; the delivery rate is the daily ratio of the two and is approximate because a message accepted late in a day can be delivered the next day.
- The delivery export does not carry notification-open signal, so opens are not synced; link FCM to Google Analytics and use the analytics connector if you need opens.
- The delivery export does not carry per-topic subscriber counts, so subscriber/opt-in metrics are not synced; only messages actually sent to a topic are counted in the per-topic metric.
- Each BigQuery query is billed against the configured projectId; over long lookback windows the cost adds up. Prefer once-a-day syncs and reasonable lookbackDays.
- The delivery export is streamed; the trailing 2 days are always refetched on incremental syncs to pick up late-arriving rows.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Firebase API docs](https://firebase.google.com/docs/cloud-messaging/understand-delivery)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
