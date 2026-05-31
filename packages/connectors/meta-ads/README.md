<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-meta-ads

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-meta-ads)](https://www.npmjs.com/package/@rawdash/connector-meta-ads)
[![license](https://img.shields.io/npm/l/@rawdash/connector-meta-ads)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Meta (Facebook + Instagram) ad campaigns plus daily campaign, adset, and ad-level insights - spend, impressions, clicks, reach, conversions, and conversion value.

## Install

```sh
npm install @rawdash/connector-meta-ads
```

## Authentication

A long-lived System User access token from Meta Business Manager, scoped with `ads_read` (and `read_insights` on newer accounts) for the target ad account.

1. In Meta Business Manager → Business Settings → Users → System Users, create a System User (or reuse an existing one) and assign it to the ad account with at least the Advertiser role.
2. Generate a System User access token for the System User; pick `ads_read` and (where available) `read_insights` as the scopes. Choose the longest available expiry - System User tokens can be made effectively non-expiring.
3. Find the ad account ID in Ads Manager → Settings → Account info; it always starts with `act_`.
4. Store the token as a secret and reference it from the connector config as `accessToken: secret("META_ACCESS_TOKEN")` alongside `adAccountId: "act_<id>"`.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                |
| -------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adAccountId`  | string | Yes      | Meta Marketing API ad account ID. Find it in Ads Manager → Settings → Account info; it always starts with `act_`.                                          |
| `accessToken`  | secret | Yes      | Long-lived System User access token from Meta Business Manager with `ads_read` (and, for newer accounts, `read_insights`) scopes on the chosen ad account. |
| `apiVersion`   | string | No       | Pin a specific Meta Graph API version (e.g. `v21.0`). Defaults to `v21.0`.                                                                                 |
| `lookbackDays` | number | No       | How many calendar days of insights to fetch on a full sync. Defaults to 90.                                                                                |
| `resources`    | array  | No       | Which Meta resources to sync. Omit to sync all. Ad-level insights are the most expensive - leave them out if you only need campaign or adset rollups.      |

## Resources

- **`meta_campaign`** _(entity)_ - Meta ad campaigns with name, objective, status, and budget. Upserted by id; one row per campaign in the ad account.
  - Endpoint: `GET /{ad_account_id}/campaigns`
- **`meta_campaign_insights`** _(metric)_ - Daily campaign-level Meta Ads insights - spend (primary value), impressions, clicks, reach, conversions, and conversion value bucketed by campaign.
  - Endpoint: `GET /{ad_account_id}/insights?level=campaign&time_increment=1`
  - Unit: spend
  - Granularity: day
  - Dimensions: `date`, `campaignId`, `campaignName`, `impressions`, `clicks`, `spend`, `reach`, `conversions`, `conversion_value`
  - Primary value is `spend`. `conversions` is the sum of every entry in the upstream `actions` array; `conversion_value` is the sum of every entry in `action_values`.
- **`meta_adset_insights`** _(metric)_ - Daily adset-level Meta Ads insights - same fields as the campaign roll-up, bucketed by adset.
  - Endpoint: `GET /{ad_account_id}/insights?level=adset&time_increment=1`
  - Unit: spend
  - Granularity: day
  - Dimensions: `date`, `campaignId`, `campaignName`, `adsetId`, `adsetName`, `impressions`, `clicks`, `spend`, `reach`, `conversions`, `conversion_value`
  - Primary value is `spend`. Includes campaign_id/campaign_name so adset rows are easy to roll up to their parent campaign.
- **`meta_ad_insights`** _(metric)_ - Daily ad-level Meta Ads insights - same fields as the adset roll-up, bucketed by ad.
  - Endpoint: `GET /{ad_account_id}/insights?level=ad&time_increment=1`
  - Unit: spend
  - Granularity: day
  - Dimensions: `date`, `campaignId`, `campaignName`, `adsetId`, `adsetName`, `adId`, `adName`, `impressions`, `clicks`, `spend`, `reach`, `conversions`, `conversion_value`
  - Primary value is `spend`. Cardinality is the highest of the three insights resources - opt in via `resources: [..., "ad_insights"]` only when you need per-ad breakdowns.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const metaAds = {
  name: 'metaAds',
  connectorId: 'meta-ads',
  config: {
    adAccountId: 'act_1234567890',
    accessToken: secret('META_ACCESS_TOKEN'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [metaAds],
  dashboards: {
    marketing: defineDashboard({
      widgets: {
        spend_30d: {
          kind: 'stat',
          title: 'Meta Ads spend (30d)',
          window: '30d',
          metric: defineMetric({
            connector: metaAds,
            shape: 'metric',
            name: 'meta_campaign_insights',
            field: 'spend',
            fn: 'sum',
          }),
        },
        daily_spend: {
          kind: 'timeseries',
          title: 'Daily Meta Ads spend',
          window: '30d',
          metric: defineMetric({
            connector: metaAds,
            shape: 'metric',
            name: 'meta_campaign_insights',
            field: 'spend',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Meta enforces per-app and per-ad-account budgets surfaced through the `X-Business-Use-Case-Usage` header. Sync at most every few hours per ad account; very large accounts may need a daily cadence.

## Limitations

- Insights are always fetched at daily granularity. Sub-daily breakdowns are not supported.
- Insights for the most recent 3 days are re-fetched on every sync because Meta keeps attributing conversions after the event date.
- Creative-level breakdowns (publisher_platform, placement, demographics) are intentionally out of scope to keep the metric cardinality bounded.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Meta API docs](https://developers.facebook.com/docs/marketing-api/insights)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
