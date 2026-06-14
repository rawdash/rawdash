<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-google-play-console

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-google-play-console)](https://www.npmjs.com/package/@rawdash/connector-google-play-console)
[![license](https://img.shields.io/npm/l/@rawdash/connector-google-play-console)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync daily Android app vitals from the Play Developer Reporting API - crash rate, ANR rate, ratings, and error counts.

## Install

```sh
npm install @rawdash/connector-google-play-console
```

## Authentication

Authenticate against the Play Developer Reporting API and the Android Publisher API with a Google service account JSON key. The service account must be linked to your Play Console developer account.

1. In Google Cloud, create a service account at IAM & Admin -> Service Accounts and download a JSON key.
2. Enable both the "Google Play Android Developer API" and the "Google Play Developer Reporting API" on the Cloud project.
3. In Google Play Console open Setup -> API access, link the same Cloud project, then invite the service account email and grant it at least the "View app information and download bulk reports" permission for the app you want to sync.
4. Store the service account JSON as a secret and reference it as serviceAccountJson: secret("GPLAY_SA_JSON").
5. Set packageName to the reverse-DNS application id of the app (e.g. com.example.app).

## Configuration

| Field                | Type   | Required | Description                                                                                                                                                                                                                                                                  |
| -------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packageName`        | string | Yes      | Reverse-DNS application id of the Android app (e.g. com.example.app). Visible in the Play Console URL and on Google Play under "About".                                                                                                                                      |
| `serviceAccountJson` | secret | Yes      | Contents of the JSON key file for a Google service account that has been granted access to your Play Console developer account with at least the "View app information and download bulk reports" permission. Create one at Google Cloud -> IAM & Admin -> Service Accounts. |
| `lookbackDays`       | number | No       | How many calendar days to fetch on a full sync. Defaults to 30. The Play Developer Reporting API exposes daily metrics with a typical 2-3 day reporting lag.                                                                                                                 |

## Resources

- **`apps`** _(entity)_ - Android app the connector is syncing. One entity per configured packageName.
  - Endpoint: `GET /androidpublisher/v3/applications/{packageName}/listings`
  - `package_name`: Reverse-DNS application id (e.g. com.example.app).
  - `title`: Play Store listing title in the default language. Empty if the listing has not been fetched yet.
  - `default_language`: Default language code (BCP-47) configured for the Play Store listings.
- **`gplay_crash_rate_by_day`** _(metric)_ - Daily crash rate reported by the Play Developer Reporting API. Primary value is the crashRate metric (fraction of distinct users that experienced a crash).
  - Endpoint: `POST /v1beta1/apps/{packageName}/crashRateMetricSet:query`
  - Unit: crashRate
  - Granularity: day
  - Dimensions: `date`, `package_name`
- **`gplay_anr_rate_by_day`** _(metric)_ - Daily ANR (Application Not Responding) rate. Primary value is the anrRate metric (fraction of distinct users that experienced an ANR).
  - Endpoint: `POST /v1beta1/apps/{packageName}/anrRateMetricSet:query`
  - Unit: anrRate
  - Granularity: day
  - Dimensions: `date`, `package_name`
- **`gplay_ratings_by_day`** _(metric)_ - Daily average user rating and rating count from the Play Developer Reporting API.
  - Endpoint: `POST /v1beta1/apps/{packageName}/ratingsMetricSet:query`
  - Unit: stars
  - Granularity: day
  - Dimensions: `date`, `package_name`
- **`gplay_error_count_by_day`** _(metric)_ - Daily count of error reports (crashes + ANRs + handled errors) from the Play Developer Reporting API.
  - Endpoint: `POST /v1beta1/apps/{packageName}/errorCountMetricSet:query`
  - Unit: reports
  - Granularity: day
  - Dimensions: `date`, `package_name`

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const googlePlayConsole = {
  name: 'googlePlayConsole',
  connectorId: 'google-play-console',
  config: {
    packageName: 'com.example.app',
    serviceAccountJson: secret('GPLAY_SA_JSON'),
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [googlePlayConsole],
  dashboards: {
    mobile: defineDashboard({
      widgets: {
        crashRate: {
          kind: 'timeseries',
          title: 'Daily crash rate',
          window: '30d',
          metric: defineMetric({
            connector: googlePlayConsole,
            shape: 'metric',
            name: 'gplay_crash_rate_by_day',
            fn: 'avg',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

The Play Developer Reporting API enforces a per-project quota (default 60 requests per minute); 429 responses are retried with exponential backoff.

## Limitations

- Daily vitals (crash rate, ANR rate, ratings, error counts) have a 2-3 day reporting lag on the Play Developer Reporting API; incremental syncs refetch the trailing 3 days.
- Install counts and earnings are not exposed through the Reporting API - Google delivers them only as monthly CSV reports in a private Cloud Storage bucket. Those metrics are out of scope for this connector and will land in a follow-up.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Google Play Console API docs](https://developers.google.com/play/developer/reporting)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
