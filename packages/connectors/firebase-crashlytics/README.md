<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-firebase-crashlytics

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-firebase-crashlytics)](https://www.npmjs.com/package/@rawdash/connector-firebase-crashlytics)
[![license](https://img.shields.io/npm/l/@rawdash/connector-firebase-crashlytics)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Track mobile app reliability over time from the Firebase Crashlytics -> BigQuery export: daily crashes, crash-free user rate, and top issues by impact.

## Install

```sh
npm install @rawdash/connector-firebase-crashlytics
```

## Authentication

Authenticate against the BigQuery API with a Google service account JSON key. The service account needs the BigQuery Data Viewer role on the Crashlytics export dataset and the BigQuery Job User role on the project that runs the queries.

1. Enable the Firebase Crashlytics -> BigQuery export in the Firebase console (Project Settings -> Integrations -> BigQuery). This is a manual one-time setup per project; data starts flowing into the firebase_crashlytics dataset within a day.
2. Create a service account at Google Cloud -> IAM & Admin -> Service Accounts in the same project (or grant an existing one access).
3. Grant the service account roles/bigquery.dataViewer on the Crashlytics dataset (so it can read the export tables) and roles/bigquery.jobUser on the project (so it can run query jobs).
4. Generate a JSON key for the service account and store its contents as a secret (e.g. FIREBASE_SA_JSON).
5. Reference the key from config as serviceAccountJson: secret("FIREBASE_SA_JSON") and set projectId to the Firebase project that owns the export.

## Configuration

| Field                | Type   | Required | Description                                                                                                                                                                                        |
| -------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serviceAccountJson` | secret | Yes      | Contents of the JSON key file for a Google service account with the role required by this connector. Create one at Google Cloud -> IAM & Admin -> Service Accounts and store the JSON as a secret. |
| `projectId`          | string | Yes      | Project that hosts the Firebase Crashlytics -> BigQuery export (also the project used to bill the BigQuery queries this connector runs).                                                           |
| `bqDataset`          | string | No       | BigQuery dataset containing the Crashlytics export tables. Defaults to firebase_crashlytics (the default name Firebase uses when you enable the export).                                           |
| `bqLocation`         | string | No       | Region or multi-region of the Crashlytics dataset (e.g. US, EU, us-central1). Defaults to US.                                                                                                      |
| `lookbackDays`       | number | No       | How many days of history to query on a full sync. Defaults to 90.                                                                                                                                  |
| `topIssuesLimit`     | number | No       | How many top issues to retain per sync, ranked by event count over the backfill window. Defaults to 50.                                                                                            |

## Resources

- **`crashes_per_day`** _(metric)_ - Daily crash counts and approximate crash-free user rate per (date, application version, platform). One sample per day per app/version/platform combination present in the Crashlytics BigQuery export.
  - Endpoint: `POST /bigquery/v2/projects/{projectId}/queries`
  - Unit: crashes
  - Granularity: daily
  - Dimensions: `app_id`, `platform`, `version`, `crash_free_user_rate`, `crashing_users`
  - Reads from firebase*crashlytics.<bundle>*<platform>\_\* via a wildcard. The trailing 2 days are always refetched on incremental syncs to pick up streamed rows.
- **`top_issues`** _(entity)_ - Top crash issues by event count over the backfill window, ranked across all apps and versions present in the export. One entity per Crashlytics issue id.
  - Endpoint: `POST /bigquery/v2/projects/{projectId}/queries`
  - topIssuesLimit caps how many issues are retained per sync (default 50). Rows are sorted by descending event count over the backfill window.
  - `issue_id`: Stable Crashlytics issue identifier.
  - `title`: Issue title (most recent value seen for this issue id within the window).
  - `subtitle`: Issue subtitle (most recent value seen for this issue id within the window).
  - `app_id`: Bundle identifier (iOS) or package name (Android) most recently seen for this issue.
  - `platform`: Application platform (ios, android, or unknown).
  - `event_count`: Total crash events attributed to this issue within the backfill window.
  - `user_count`: Distinct users that experienced this issue within the backfill window.
  - `last_seen`: ISO timestamp of the most recent event for this issue within the window.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const crashlytics = {
  name: 'crashlytics',
  connectorId: 'firebase-crashlytics',
  config: {
    serviceAccountJson: secret('FIREBASE_SA_JSON'),
    projectId: 'my-firebase-project',
    bqDataset: 'firebase_crashlytics',
    bqLocation: 'US',
    lookbackDays: 90,
    topIssuesLimit: 50,
  },
};

export default defineConfig({
  connectors: [crashlytics],
  dashboards: {
    mobile: defineDashboard({
      widgets: {
        crashes: {
          kind: 'stat',
          title: 'Crashes (last 7d)',
          metric: defineMetric({
            connector: crashlytics,
            shape: 'metric',
            name: 'crashes_per_day',
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

- Requires the Firebase Crashlytics -> BigQuery export to be configured in the Firebase console; that step is manual and one-time per project, and only days after the configuration date are present in the export.
- Reads the firebase*crashlytics.<bundle>*<platform> tables via a wildcard; one row in storage covers one app/version/platform tuple per day.
- Crash-free user rate is approximated from the daily ratio of unique crashing users to total event users observed in the export; matching the Firebase console number exactly requires the full Crashlytics signal, not just the BigQuery export.
- Each BigQuery query is billed against the configured projectId; over long lookback windows the cost adds up. Prefer once-a-day syncs and reasonable lookbackDays.
- The Crashlytics BigQuery export is streamed; the trailing 2 days are always refetched on incremental syncs to pick up late-arriving rows.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Firebase API docs](https://firebase.google.com/docs/crashlytics/bigquery-export)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
