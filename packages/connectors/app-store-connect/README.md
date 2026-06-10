<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-app-store-connect

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-app-store-connect)](https://www.npmjs.com/package/@rawdash/connector-app-store-connect)
[![license](https://img.shields.io/npm/l/@rawdash/connector-app-store-connect)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync your iOS / macOS apps, daily sales (downloads and proceeds), and customer review ratings from the App Store Connect API for mobile-team dashboards.

> **Cost & frequency.** Daily sales reports are only finalized 24-48 hours after the day closes; syncing more often than the recommended interval will not bring fresher revenue data. Recommended sync interval: **6 hours**. Minimum sensible interval: **1 hour**.

## Install

```sh
npm install @rawdash/connector-app-store-connect
```

## Authentication

App Store Connect API uses an ES256-signed JWT minted per request from an issuer ID, key ID, and a PKCS#8 EC private key (.p8) downloaded from App Store Connect. The key only needs read access to Sales and Reports.

1. Open App Store Connect -> Users and Access -> Integrations -> App Store Connect API.
2. Generate a key with the "Sales" or "Finance" role (read-only is enough). Copy the key ID shown in the table; capture the issuer ID at the top of the page.
3. Download the .p8 file once on creation - Apple does not let you re-download it.
4. Store the .p8 contents as a secret (e.g. APPSTORECONNECT_P8) and reference it as `privateKey: secret("APPSTORECONNECT_P8")`.
5. Set `vendorNumber` from App Store Connect -> Payments and Financial Reports (the top-left dropdown shows the 8-9 digit number). Only required for app_installs and app_revenue.

## Configuration

| Field               | Type   | Required | Description                                                                                                                                                                                |
| ------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `issuerId`          | string | Yes      | App Store Connect API issuer ID (UUID). Found at Users and Access -> Integrations -> App Store Connect API.                                                                                |
| `keyId`             | string | Yes      | App Store Connect API key ID (10 characters). Shown next to the key in Users and Access -> Integrations -> App Store Connect API.                                                          |
| `privateKey`        | secret | Yes      | Contents of the App Store Connect API private key file (.p8). PKCS#8 PEM, starting with -----BEGIN PRIVATE KEY-----. Apple only lets you download the key once on creation.                |
| `vendorNumber`      | string | No       | Apple vendor number (8-9 digit numeric). Required to sync sales reports (app_installs and app_revenue). Found in App Store Connect -> Payments and Financial Reports -> top-left dropdown. |
| `resources`         | array  | No       | Which App Store Connect resources to sync. Omit to sync all resources. Sales-derived resources (app_installs, app_revenue) require vendorNumber and are silently skipped without it.       |
| `salesBackfillDays` | number | No       | How many days of daily sales reports to pull on a full sync. Defaults to 30. Apple keeps daily reports for the last 365 days.                                                              |
| `reviewLimit`       | number | No       | Most-recent customer reviews to fetch per app for the app_ratings metric. Defaults to 200 (one Apple page). Higher values smooth the rolling rating at the cost of more requests.          |

## Resources

- **`app_store_connect_app`** _(entity)_ - Apps registered in the team, with bundle id, SKU, and primary locale. Synced from /v1/apps.
  - Endpoint: `GET /v1/apps`
  - `name`: App display name.
  - `bundleId`: Bundle identifier, e.g. com.example.app.
  - `sku`: App SKU set when the app was registered.
  - `primaryLocale`: Primary App Store locale, e.g. en-US.
- **`app_store_connect_app_installs`** _(metric)_ - Daily installs (units sold or downloaded) aggregated from the SALES SUMMARY report by (date, app, country code, product type). One sample per (day, app, country, productTypeIdentifier).
  - Endpoint: `GET /v1/salesReports`
  - Granularity: daily
  - Dimensions: `appId`, `countryCode`, `productTypeIdentifier`
  - Requires a vendor number. Apple delays daily reports by ~24-48 hours; the connector backs off two days from today to avoid empty / partial reports. Reports are gzipped TSV under the hood.
- **`app_store_connect_app_revenue`** _(metric)_ - Daily developer proceeds aggregated from the SALES SUMMARY report by (date, app, country code, product type). Values are summed across rows that share a currency; rows are emitted per currency.
  - Endpoint: `GET /v1/salesReports`
  - Unit: native currency (see currency attribute)
  - Granularity: daily
  - Dimensions: `appId`, `countryCode`, `currency`, `productTypeIdentifier`
  - Proceeds are NOT FX-normalised; each sample carries its native currency in the `currency` attribute. Filter or convert downstream.
- **`app_store_connect_app_ratings`** _(metric)_ - Rolling per-review ratings sampled from the most-recent N customer reviews per app (default 200). Each sample carries one review with the rating (1-5) as the value and the territory on the attribute.
  - Endpoint: `GET /v1/apps/{id}/customerReviews`
  - Dimensions: `appId`, `territory`
  - Apple does NOT expose the lifetime average rating over the REST API. Average over a time window downstream to get a rolling rating.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const appStoreConnect = {
  name: 'app-store-connect',
  connectorId: 'app-store-connect',
  config: {
    issuerId: '69a6de7f-0000-0000-0000-000000000000',
    keyId: 'ABC1234DEF',
    privateKey: secret('APPSTORECONNECT_P8'),
    vendorNumber: '85912345',
  },
};

export default defineConfig({
  connectors: [appStoreConnect],
  dashboards: {
    mobile: defineDashboard({
      widgets: {
        app_count: {
          kind: 'stat',
          title: 'Apps',
          metric: defineMetric({
            connector: appStoreConnect,
            shape: 'entity',
            entityType: 'app_store_connect_app',
            fn: 'count',
          }),
        },
        installs_total: {
          kind: 'stat',
          title: 'Installs (synced window)',
          metric: defineMetric({
            connector: appStoreConnect,
            shape: 'metric',
            name: 'app_store_connect_app_installs',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

App Store Connect enforces a 3,600 requests-per-hour quota per team. The shared HTTP client backs off on 429 using Retry-After. Sales report endpoints are billed in the same bucket and cost one request per (day, report) pair.

## Limitations

- app_crashes (per-build crash counts) is not implemented. Apple only exposes crash analytics via the asynchronous Analytics Reports flow (create report request -> poll for completion -> download gzipped CSV) which spans multiple syncs; a follow-up will add it.
- app_ratings is sampled from the most recent N customer reviews per app (default 200, capped at 2,000). It is a rolling rating, not the lifetime average shown in the App Store, because Apple does not expose lifetime aggregates over the REST API.
- Sales reports are pulled in DAILY frequency only; weekly, monthly, and yearly summaries are not synced.
- Subscription, in-app-purchase, and refund line items in the SALES summary report are aggregated into `units` and `proceeds` rather than broken out by product type. Filter by `productTypeIdentifier` on the metric sample attributes if you need to separate them.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Apple API docs](https://developer.apple.com/documentation/appstoreconnectapi)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
