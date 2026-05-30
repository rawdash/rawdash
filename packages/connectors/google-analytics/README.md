<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-google-analytics

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-google-analytics)](https://www.npmjs.com/package/@rawdash/connector-google-analytics)
[![license](https://img.shields.io/npm/l/@rawdash/connector-google-analytics)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync daily GA4 traffic, acquisition, top pages, events, conversions, and geography metrics from a Google Analytics 4 property.

## Install

```sh
npm install @rawdash/connector-google-analytics
```

## Authentication

Authenticate against the GA4 Data API with either a Google service account JSON key (recommended) or an OAuth 2.0 refresh-token tuple. The identity must have at least the Analytics Viewer role on the property.

1. Find your GA4 Property ID under Google Analytics -> Admin -> Property settings (numeric, e.g. 123456789).
2. Recommended: create a service account at Google Cloud -> IAM & Admin -> Service Accounts, generate a JSON key, and grant it the Analytics Viewer role on the property. Store the JSON as a secret and reference it as serviceAccountJson: secret("GA4_SERVICE_ACCOUNT_JSON").
3. Alternative: provide an OAuth 2.0 refresh token with the analytics.readonly scope together with its clientId and clientSecret from the Google Cloud Console.

## Configuration

| Field                | Type   | Required | Description                                                                                                                                             |
| -------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `propertyId`         | string | Yes      | Numeric ID of your GA4 property (e.g. 123456789). Find it in Google Analytics → Admin → Property settings.                                              |
| `serviceAccountJson` | secret | No       | Contents of the JSON key file for a Google service account with the Analytics Viewer role. Create one at Google Cloud → IAM & Admin → Service Accounts. |
| `refreshToken`       | secret | No       | Google OAuth 2.0 refresh token with analytics.readonly scope. Required if not using serviceAccountJson.                                                 |
| `clientId`           | string | No       | OAuth 2.0 client ID from Google Cloud Console. Required when using refreshToken auth.                                                                   |
| `clientSecret`       | secret | No       | OAuth 2.0 client secret from Google Cloud Console. Required when using refreshToken auth.                                                               |
| `lookbackDays`       | number | No       | How many calendar days to fetch on a full sync. Defaults to 90.                                                                                         |

## Resources

- **`ga4_traffic_by_day`** _(metric)_ - Daily site traffic totals - sessions, total users, new users, page views, and engagement rate.
  - Endpoint: `POST /v1beta/properties/{propertyId}:runReport`
  - Unit: sessions
  - Granularity: day
  - Dimensions: `date`
- **`ga4_traffic_by_source`** _(metric)_ - Daily sessions and conversions broken down by acquisition source and medium.
  - Endpoint: `POST /v1beta/properties/{propertyId}:runReport`
  - Unit: sessions
  - Granularity: day
  - Dimensions: `date`, `sessionSource`, `sessionMedium`
- **`ga4_top_pages`** _(metric)_ - Daily page views and average session duration bucketed by page path.
  - Endpoint: `POST /v1beta/properties/{propertyId}:runReport`
  - Unit: page_views
  - Granularity: day
  - Dimensions: `date`, `pagePath`
- **`ga4_events`** _(metric)_ - Daily event counts and the users that triggered them, bucketed by event name.
  - Endpoint: `POST /v1beta/properties/{propertyId}:runReport`
  - Unit: events
  - Granularity: day
  - Dimensions: `date`, `eventName`
- **`ga4_conversions`** _(metric)_ - Daily conversion counts and total revenue bucketed by conversion event name.
  - Endpoint: `POST /v1beta/properties/{propertyId}:runReport`
  - Unit: conversions
  - Granularity: day
  - Dimensions: `date`, `eventName`
- **`ga4_geo`** _(metric)_ - Daily sessions and total users bucketed by visitor country.
  - Endpoint: `POST /v1beta/properties/{propertyId}:runReport`
  - Unit: sessions
  - Granularity: day
  - Dimensions: `date`, `country`

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const googleAnalytics = {
  name: 'googleAnalytics',
  connectorId: 'google-analytics',
  config: {
    propertyId: '123456789',
    serviceAccountJson: secret('GA4_SERVICE_ACCOUNT_JSON'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [googleAnalytics],
  dashboards: {
    traffic: defineDashboard({
      widgets: {
        sessions: {
          kind: 'timeseries',
          title: 'Daily sessions',
          window: '30d',
          metric: defineMetric({
            connector: googleAnalytics,
            shape: 'metric',
            name: 'ga4_traffic_by_day',
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

- Incremental syncs use a 30-day window because GA4 can attribute conversions up to 3 days after the session.
- Report pagination is 10,000 rows per page.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Google Analytics API docs](https://developers.google.com/analytics/devguides/reporting/data/v1)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
