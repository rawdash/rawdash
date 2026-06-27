<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-google-play-console

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-google-play-console)](https://www.npmjs.com/package/@rawdash/connector-google-play-console)
[![license](https://img.shields.io/npm/l/@rawdash/connector-google-play-console)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync daily Android app vitals from the Play Developer Reporting API (crash rate, ANR rate, error counts) plus user review ratings from the Android Publisher API.

## Install

```sh
npm install @rawdash/connector-google-play-console
```

## Authentication

Authenticate against the Play Developer Reporting API and the Android Publisher API with a Google service account JSON key. The service account must be linked to your Play Console developer account.

1. In Google Cloud, create a service account at IAM & Admin -> Service Accounts and download a JSON key.
2. Enable both the "Google Play Developer Reporting API" and the "Google Play Android Developer API" on the Cloud project.
3. In Google Play Console open Setup -> API access, link the same Cloud project, then invite the service account email and grant it at least the "View app information and download bulk reports" permission for the app you want to sync.
4. For the `gplay_installs_*` resources, grant bucket access inside Play Console, not Google Cloud IAM: the install reports live in a Google-managed Cloud Storage bucket provisioned for your developer account. In Play Console -> Users & permissions, give the service account the account-level "View app information and download bulk reports" permission set to Global (changes can take a few hours to propagate), then copy the bucket id from the Download reports page (the Cloud Storage URI starts with `gs://pubsite_prod_...`) into installsBucketId.
5. Store the service account JSON as a secret and reference it as serviceAccountJson: secret("GPLAY_SA_JSON").
6. Set packageName to the reverse-DNS application id of the app (e.g. com.example.app).

## Configuration

| Field                | Type   | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packageName`        | string | Yes      | Reverse-DNS application id of the Android app (e.g. com.example.app). Visible in the Play Console URL and on Google Play under "About".                                                                                                                                                                                                                                                                                                                                                                    |
| `serviceAccountJson` | secret | Yes      | Contents of the JSON key file for a Google service account that has been granted access to your Play Console developer account with at least the "View app information and download bulk reports" permission. Create one at Google Cloud -> IAM & Admin -> Service Accounts.                                                                                                                                                                                                                               |
| `lookbackDays`       | number | No       | How many calendar days to fetch on a full sync. Defaults to 30. The Play Developer Reporting API exposes daily metrics with a typical 2-3 day reporting lag.                                                                                                                                                                                                                                                                                                                                               |
| `reviewLimit`        | number | No       | How many of the most-recent user reviews to emit as gplay_app_ratings samples. Defaults to 200. Reviews are fetched then ranked newest-first before this cap is applied. The Android Publisher reviews API only surfaces reviews from roughly the past week, so this is a rolling sample, not a full history.                                                                                                                                                                                              |
| `installsBucketId`   | string | No       | Cloud Storage bucket id that holds your Play Console reports (e.g. `pubsite_prod_rev_01234567890987654321`), shown via "Copy Cloud Storage URI" on the Play Console Download reports page. Required only for the `gplay_installs_*` resources, which read the monthly stats/installs CSV reports. The bucket is Google-managed; the service account is granted access through Play Console (Users & permissions -> "View app information and download bulk reports", set to Global), not Google Cloud IAM. |

## Resources

- **`apps`** _(entity)_ - Android app the connector is syncing. One entity per configured packageName, derived from the connector config; the Play Store listing title is only reachable through an Android Publisher edit and is not fetched.
  - `package_name`: Reverse-DNS application id (e.g. com.example.app).
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
- **`gplay_error_count_by_day`** _(metric)_ - Daily count of error reports (crashes + ANRs + handled errors) from the Play Developer Reporting API.
  - Endpoint: `POST /v1beta1/apps/{packageName}/errorCountMetricSet:query`
  - Unit: reports
  - Granularity: day
  - Dimensions: `date`, `package_name`
- **`gplay_app_ratings`** _(metric)_ - Rolling per-review star ratings sampled from the most-recent user reviews via the Android Publisher reviews API (default 200, configurable via reviewLimit). Each sample carries one review with its star rating (1-5) as the value.
  - Endpoint: `GET /androidpublisher/v3/applications/{packageName}/reviews`
  - Unit: stars
  - Dimensions: `package_name`, `review_id`, `reviewer_language`, `device`, `app_version_name`, `android_os_version`
  - Not the lifetime average shown on the Play Store. The reviews API only returns reviews from roughly the past week, so this is a rolling sample; average over a time window downstream for a smoothed rating.
- **`gplay_installs_overview_by_day`** _(metric)_ - Daily install statistics for the app from the Play Console monthly installs report (stats/installs overview CSV). Primary value is Daily Device Installs; uninstalls, upgrades, active-device installs and user-keyed counts are carried as additional attributes.
  - Endpoint: `GET /storage/v1/b/{installsBucketId}/o/stats%2Finstalls%2Finstalls_{packageName}_{YYYYMM}_overview.csv`
  - Unit: installs
  - Granularity: day
  - Dimensions: `date`, `package_name`
  - Measures: `daily_device_installs`, `daily_device_uninstalls`, `daily_device_upgrades`, `current_device_installs`, `active_device_installs`, `current_user_installs`, `total_user_installs`, `daily_user_installs`, `daily_user_uninstalls`
  - Sourced from the Play Console monthly stats/installs CSV in Cloud Storage. Files are monthly with daily rows and arrive a few days in arrears; the connector refetches the months overlapping the sync window.
- **`gplay_installs_by_country`** _(metric)_ - Daily install statistics broken down by country/region from the Play Console monthly installs report (stats/installs country CSV).
  - Endpoint: `GET /storage/v1/b/{installsBucketId}/o/stats%2Finstalls%2Finstalls_{packageName}_{YYYYMM}_country.csv`
  - Unit: installs
  - Granularity: day
  - Dimensions: `date`, `package_name`, `country`
  - Measures: `daily_device_installs`, `daily_device_uninstalls`, `daily_device_upgrades`, `current_device_installs`, `active_device_installs`, `current_user_installs`, `total_user_installs`, `daily_user_installs`, `daily_user_uninstalls`
  - Sourced from the Play Console monthly stats/installs CSV in Cloud Storage. Files are monthly with daily rows and arrive a few days in arrears; the connector refetches the months overlapping the sync window.
- **`gplay_installs_by_app_version`** _(metric)_ - Daily install statistics broken down by app version code from the Play Console monthly installs report (stats/installs app_version CSV).
  - Endpoint: `GET /storage/v1/b/{installsBucketId}/o/stats%2Finstalls%2Finstalls_{packageName}_{YYYYMM}_app_version.csv`
  - Unit: installs
  - Granularity: day
  - Dimensions: `date`, `package_name`, `app_version_code`
  - Measures: `daily_device_installs`, `daily_device_uninstalls`, `daily_device_upgrades`, `current_device_installs`, `active_device_installs`, `current_user_installs`, `total_user_installs`, `daily_user_installs`, `daily_user_uninstalls`
  - Sourced from the Play Console monthly stats/installs CSV in Cloud Storage. Files are monthly with daily rows and arrive a few days in arrears; the connector refetches the months overlapping the sync window.
- **`gplay_installs_by_device`** _(metric)_ - Daily install statistics broken down by device from the Play Console monthly installs report (stats/installs device CSV).
  - Endpoint: `GET /storage/v1/b/{installsBucketId}/o/stats%2Finstalls%2Finstalls_{packageName}_{YYYYMM}_device.csv`
  - Unit: installs
  - Granularity: day
  - Dimensions: `date`, `package_name`, `device`
  - Measures: `daily_device_installs`, `daily_device_uninstalls`, `daily_device_upgrades`, `current_device_installs`, `active_device_installs`, `current_user_installs`, `total_user_installs`, `daily_user_installs`, `daily_user_uninstalls`
  - Sourced from the Play Console monthly stats/installs CSV in Cloud Storage. Files are monthly with daily rows and arrive a few days in arrears; the connector refetches the months overlapping the sync window.
- **`gplay_installs_by_os_version`** _(metric)_ - Daily install statistics broken down by Android OS version from the Play Console monthly installs report (stats/installs os_version CSV).
  - Endpoint: `GET /storage/v1/b/{installsBucketId}/o/stats%2Finstalls%2Finstalls_{packageName}_{YYYYMM}_os_version.csv`
  - Unit: installs
  - Granularity: day
  - Dimensions: `date`, `package_name`, `android_os_version`
  - Measures: `daily_device_installs`, `daily_device_uninstalls`, `daily_device_upgrades`, `current_device_installs`, `active_device_installs`, `current_user_installs`, `total_user_installs`, `daily_user_installs`, `daily_user_uninstalls`
  - Sourced from the Play Console monthly stats/installs CSV in Cloud Storage. Files are monthly with daily rows and arrive a few days in arrears; the connector refetches the months overlapping the sync window.
- **`gplay_installs_by_language`** _(metric)_ - Daily install statistics broken down by language from the Play Console monthly installs report (stats/installs language CSV).
  - Endpoint: `GET /storage/v1/b/{installsBucketId}/o/stats%2Finstalls%2Finstalls_{packageName}_{YYYYMM}_language.csv`
  - Unit: installs
  - Granularity: day
  - Dimensions: `date`, `package_name`, `language`
  - Measures: `daily_device_installs`, `daily_device_uninstalls`, `daily_device_upgrades`, `current_device_installs`, `active_device_installs`, `current_user_installs`, `total_user_installs`, `daily_user_installs`, `daily_user_uninstalls`
  - Sourced from the Play Console monthly stats/installs CSV in Cloud Storage. Files are monthly with daily rows and arrive a few days in arrears; the connector refetches the months overlapping the sync window.
- **`gplay_installs_by_carrier`** _(metric)_ - Daily install statistics broken down by carrier from the Play Console monthly installs report (stats/installs carrier CSV).
  - Endpoint: `GET /storage/v1/b/{installsBucketId}/o/stats%2Finstalls%2Finstalls_{packageName}_{YYYYMM}_carrier.csv`
  - Unit: installs
  - Granularity: day
  - Dimensions: `date`, `package_name`, `carrier`
  - Measures: `daily_device_installs`, `daily_device_uninstalls`, `daily_device_upgrades`, `current_device_installs`, `active_device_installs`, `current_user_installs`, `total_user_installs`, `daily_user_installs`, `daily_user_uninstalls`
  - Sourced from the Play Console monthly stats/installs CSV in Cloud Storage. Files are monthly with daily rows and arrive a few days in arrears; the connector refetches the months overlapping the sync window.

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

- Daily vitals (crash rate, ANR rate, error counts) have a 2-3 day reporting lag on the Play Developer Reporting API; incremental syncs refetch the trailing 3 days. Metric days are reported on the America/Los_Angeles calendar, the only timezone the API supports for daily aggregation.
- gplay_app_ratings is a rolling sample of recent reviews from the Android Publisher reviews API (default 200, configurable via reviewLimit). Each sample carries one review with its star rating (1-5) as the value; this is not the lifetime average shown on the Play Store, and the reviews API only surfaces reviews from roughly the past week.
- The apps entity carries only the configured package name; the Play Store listing title is available solely through an Android Publisher edit, which this connector does not create.
- The `gplay_installs_*` resources read the monthly stats/installs CSV reports from your Play Console Cloud Storage bucket, not the Reporting API; they require installsBucketId plus the account-level "View app information and download bulk reports" permission granted to the service account in Play Console (the bucket is Google-managed; access is not configured through Google Cloud IAM). Files are published monthly (with daily rows) and a few days in arrears, so the current month fills in over time and the most recent days lag. Earnings/financial reports remain out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Google Play Console API docs](https://developers.google.com/play/developer/reporting)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
