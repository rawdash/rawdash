<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-firebase-analytics

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-firebase-analytics)](https://www.npmjs.com/package/@rawdash/connector-firebase-analytics)
[![license](https://img.shields.io/npm/l/@rawdash/connector-firebase-analytics)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync DAU/WAU/MAU, per-event activity, and cohort retention from a Firebase project via the GA4 Data API.

## Install

```sh
npm install @rawdash/connector-firebase-analytics
```

## Authentication

Firebase Analytics data is exposed through the linked GA4 property. Authenticate against the GA4 Data API with either a Google service account JSON key (recommended) or an OAuth 2.0 refresh-token tuple. The identity must have at least the Analytics Viewer role on the property.

1. In Firebase Console -> Project settings -> Integrations -> Google Analytics, note the linked GA4 property and copy its numeric Property ID from Google Analytics -> Admin -> Property settings.
2. In Firebase Console -> Project settings -> General -> Your apps, copy the Firebase App ID for the app whose analytics you want to sync.
3. Recommended: create a service account at Google Cloud -> IAM & Admin -> Service Accounts, generate a JSON key, and grant it the Analytics Viewer role on the GA4 property. Store the JSON as a secret and reference it as serviceAccountJson: secret("FIREBASE_ANALYTICS_SA_JSON").
4. Alternative: provide an OAuth 2.0 refresh token with the analytics.readonly scope together with its clientId and clientSecret from the Google Cloud Console.

## Configuration

| Field                | Type   | Required | Description                                                                                                                                                                                                     |
| -------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `propertyId`         | string | Yes      | Numeric ID of the GA4 property linked to your Firebase project (e.g. 123456789). Find it in Google Analytics -> Admin -> Property settings.                                                                     |
| `firebaseAppId`      | string | Yes      | Firebase App ID for the app whose analytics you are syncing (e.g. 1:1234567890:web:abcdef). Find it in Firebase Console -> Project settings -> General -> Your apps. Used to label samples with the source app. |
| `serviceAccountJson` | secret | No       | Contents of the JSON key file for a Google service account with the Firebase Viewer + Analytics Viewer roles. Create one at Google Cloud -> IAM & Admin -> Service Accounts.                                    |
| `refreshToken`       | secret | No       | Google OAuth 2.0 refresh token with the analytics.readonly scope. Required if not using serviceAccountJson.                                                                                                     |
| `clientId`           | string | No       | OAuth 2.0 client ID from Google Cloud Console. Required when using refreshToken auth.                                                                                                                           |
| `clientSecret`       | secret | No       | OAuth 2.0 client secret from Google Cloud Console. Required when using refreshToken auth.                                                                                                                       |
| `lookbackDays`       | number | No       | How many calendar days to fetch on a full sync. Defaults to 90.                                                                                                                                                 |

## Resources

- **`firebase_dau_wau_mau`** _(metric)_ - Daily active, weekly active, and monthly active user counts for the linked GA4 property.
  - Endpoint: `POST /v1beta/properties/{propertyId}:runReport`
  - Unit: users
  - Granularity: day
  - Dimensions: `date`
- **`firebase_events_per_day`** _(metric)_ - Daily event counts and the active users that triggered them, bucketed by event name.
  - Endpoint: `POST /v1beta/properties/{propertyId}:runReport`
  - Unit: events
  - Granularity: day
  - Dimensions: `date`, `eventName`
- **`firebase_retention`** _(metric)_ - Active users on each day grouped by the date of their first session (cohort retention).
  - Endpoint: `POST /v1beta/properties/{propertyId}:runReport`
  - Unit: users
  - Granularity: day
  - Dimensions: `firstSessionDate`, `date`
  - Each sample also carries a `period` attribute equal to (date - firstSessionDate) in days, so retention curves can be built by grouping on it.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const firebaseAnalytics = {
  name: 'firebaseAnalytics',
  connectorId: 'firebase-analytics',
  config: {
    propertyId: '123456789',
    firebaseAppId: '1:1234567890:web:abcdef1234567890',
    serviceAccountJson: secret('FIREBASE_ANALYTICS_SA_JSON'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [firebaseAnalytics],
  dashboards: {
    engagement: defineDashboard({
      widgets: {
        dau: {
          kind: 'timeseries',
          title: 'Daily active users',
          window: '30d',
          metric: defineMetric({
            connector: firebaseAnalytics,
            shape: 'metric',
            name: 'firebase_dau_wau_mau',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

GA4 Data API quota is 200,000 tokens/day per property (default); 429 responses are retried automatically with exponential backoff.

## Limitations

- Incremental syncs use a 30-day window because GA4 can attribute events up to 3 days after they occur.
- Report pagination is 10,000 rows per page.
- The firebaseAppId is recorded on every sample but does not filter the report; ensure your GA4 property only contains the app you intend to sync.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Firebase Analytics API docs](https://developers.google.com/analytics/devguides/reporting/data/v1)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
