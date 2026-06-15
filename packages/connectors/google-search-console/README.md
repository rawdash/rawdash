<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-google-search-console

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-google-search-console)](https://www.npmjs.com/package/@rawdash/connector-google-search-console)
[![license](https://img.shields.io/npm/l/@rawdash/connector-google-search-console)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync daily Search Console SEO metrics - clicks, impressions, CTR, and average position - by date, query, page, and country.

## Install

```sh
npm install @rawdash/connector-google-search-console
```

## Authentication

Authenticate against the Search Console API with either a Google service account JSON key (recommended) or an OAuth 2.0 refresh-token tuple. The identity must be added as a user on the Search Console property (Owner or Full user).

1. Identify the property to sync. URL-prefix properties use the full origin (e.g. https://example.com/); Domain properties use the sc-domain:example.com format.
2. Recommended: create a service account at Google Cloud -> IAM & Admin -> Service Accounts, generate a JSON key, then in Search Console add the service account email as a user on the property. Store the JSON as a secret and reference it as serviceAccountJson: secret("GSC_SERVICE_ACCOUNT_JSON").
3. Alternative: provide an OAuth 2.0 refresh token with the webmasters.readonly scope together with its clientId and clientSecret from the Google Cloud Console.

## Configuration

| Field                | Type   | Required | Description                                                                                                                                                                                                  |
| -------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `siteUrl`            | string | Yes      | Verified Search Console property. URL-prefix properties look like "https://example.com/"; Domain properties look like "sc-domain:example.com".                                                               |
| `serviceAccountJson` | secret | No       | Contents of the JSON key file for a Google service account that has been added as a Search Console user (Owner or Full user) on the property. Create one at Google Cloud -> IAM & Admin -> Service Accounts. |
| `refreshToken`       | secret | No       | Google OAuth 2.0 refresh token with webmasters.readonly scope. Required if not using serviceAccountJson.                                                                                                     |
| `clientId`           | string | No       | OAuth 2.0 client ID from Google Cloud Console. Required when using refreshToken auth.                                                                                                                        |
| `clientSecret`       | secret | No       | OAuth 2.0 client secret from Google Cloud Console. Required when using refreshToken auth.                                                                                                                    |
| `lookbackDays`       | number | No       | How many calendar days to fetch on a full sync. Defaults to 90.                                                                                                                                              |

## Resources

- **`gsc_search_analytics_by_day`** _(metric)_ - Daily site totals - clicks, impressions, CTR, and average position across all queries and pages.
  - Endpoint: `POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query`
  - Unit: clicks
  - Granularity: day
  - Dimensions: `date`
- **`gsc_top_queries`** _(metric)_ - Daily clicks, impressions, CTR, and average position broken down by search query.
  - Endpoint: `POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query`
  - Unit: clicks
  - Granularity: day
  - Dimensions: `date`, `query`
- **`gsc_top_pages`** _(metric)_ - Daily clicks, impressions, CTR, and average position broken down by landing page URL.
  - Endpoint: `POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query`
  - Unit: clicks
  - Granularity: day
  - Dimensions: `date`, `page`
- **`gsc_top_countries`** _(metric)_ - Daily clicks, impressions, CTR, and average position broken down by visitor country.
  - Endpoint: `POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query`
  - Unit: clicks
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

const googleSearchConsole = {
  name: 'googleSearchConsole',
  connectorId: 'google-search-console',
  config: {
    siteUrl: 'https://example.com/',
    serviceAccountJson: secret('GSC_SERVICE_ACCOUNT_JSON'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [googleSearchConsole],
  dashboards: {
    seo: defineDashboard({
      widgets: {
        clicks: {
          kind: 'timeseries',
          title: 'Daily search clicks',
          window: '30d',
          metric: defineMetric({
            connector: googleSearchConsole,
            shape: 'metric',
            name: 'gsc_search_analytics_by_day',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Search Console API quota is 1,200 queries per minute per project (default); 429 responses are retried automatically with exponential backoff.

## Limitations

- Search Console aggregates data with a 2-3 day lag, so incremental syncs refetch the trailing 3 days.
- Each query is paginated 25,000 rows per page; a phase that yields more than that paginates by startRow.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Google Search Console API docs](https://developers.google.com/webmaster-tools/v1/api_reference_index)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
