<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-algolia

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-algolia)](https://www.npmjs.com/package/@rawdash/connector-algolia)
[![license](https://img.shields.io/npm/l/@rawdash/connector-algolia)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Track Algolia site search health - daily search volume, click-through rate, no-result rate, average click position, and top / no-result queries per index.

## Install

```sh
npm install @rawdash/connector-algolia
```

## Authentication

Authenticates with an Algolia Application ID and an API key that carries the analytics ACL. A read-only analytics key is sufficient; the admin key should not be used.

1. Open the Algolia dashboard -> Settings -> API Keys and note your Application ID.
2. Create a new API key restricted to the analytics ACL (optionally scoped to the indexes you want to report on). Store it as a secret (e.g. ALGOLIA_ANALYTICS_API_KEY).
3. Reference it from config as `apiKey: secret("ALGOLIA_ANALYTICS_API_KEY")` together with `appId` and the list of `indexes` to sync.
4. If your application is hosted in the EU analytics region, set `region: "de"`.

## Configuration

| Field             | Type         | Required | Description                                                                                                                                                         |
| ----------------- | ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appId`           | string       | Yes      | Algolia Application ID, found under Settings -> API Keys in the Algolia dashboard.                                                                                  |
| `apiKey`          | secret       | Yes      | An Algolia API key with the analytics ACL (read-only is sufficient). Do not use the admin key. Create a dedicated key under Settings -> API Keys.                   |
| `indexes`         | array        | Yes      | One or more Algolia index names to pull analytics for. Each index is reported as its own dimension so a single dashboard can compare them.                          |
| `region`          | `us` \| `de` | No       | Which Algolia analytics region hosts your application: "us" (analytics.us.algolia.com) or "de" (analytics.de.algolia.com). Defaults to "us".                        |
| `resources`       | array        | No       | Which Algolia analytics series to sync. Omit to sync all of them.                                                                                                   |
| `lookbackDays`    | number       | No       | How many days of analytics history to fetch on a full sync. Defaults to 30. Note: analytics retention depends on your Algolia plan, so older days may return empty. |
| `topQueriesLimit` | number       | No       | How many rows to keep for the top-queries and no-result-queries series. Defaults to 20.                                                                             |

## Resources

- **`algolia_search_count`** _(metric)_ - Daily number of searches performed against the index, from the Algolia Analytics API.
  - Endpoint: `GET /2/searches/count`
  - Unit: searches
  - Granularity: daily
  - Dimensions: `index`
- **`algolia_click_through_rate`** _(metric)_ - Daily click-through rate (fraction of tracked searches that led to a click) for the index. Requires Click Analytics to be enabled.
  - Endpoint: `GET /2/clicks/clickThroughRate`
  - Unit: rate
  - Granularity: daily
  - Dimensions: `index`
  - Measures: `click_count`, `tracked_search_count`
  - Sample value is the daily rate in [0, 1]. Click Analytics must be enabled on the index or the series is empty.
- **`algolia_no_results_rate`** _(metric)_ - Daily no-result rate (fraction of searches that returned zero hits) for the index.
  - Endpoint: `GET /2/searches/noResultRate`
  - Unit: rate
  - Granularity: daily
  - Dimensions: `index`
  - Measures: `search_count`, `no_result_count`
  - Sample value is the daily rate in [0, 1].
- **`algolia_average_click_position`** _(metric)_ - Daily average position of clicked results (1-based) for the index. Requires Click Analytics to be enabled.
  - Endpoint: `GET /2/clicks/averageClickPosition`
  - Unit: position
  - Granularity: daily
  - Dimensions: `index`
  - Measures: `click_count`
  - Days with no clicks report a null average from Algolia and are skipped rather than written as 0.
- **`algolia_top_queries`** _(metric)_ - Most frequent search queries over the sync window, with their search count and result count, for the index.
  - Endpoint: `GET /2/searches`
  - Unit: searches
  - Granularity: daily
  - Dimensions: `index`, `query`
  - Measures: `nb_hits`
  - Aggregated over the sync window and stamped at the last day of the window. Sample value is the search count for the query.
- **`algolia_no_result_queries`** _(metric)_ - Most frequent search queries that returned zero results over the sync window, for the index.
  - Endpoint: `GET /2/searches/noResults`
  - Unit: searches
  - Granularity: daily
  - Dimensions: `index`, `query`
  - Measures: `with_filter_count`
  - Aggregated over the sync window and stamped at the last day of the window. Sample value is the no-result count for the query.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const algolia = {
  name: 'algolia',
  connectorId: 'algolia',
  config: {
    appId: 'YourApplicationID',
    apiKey: secret('ALGOLIA_ANALYTICS_API_KEY'),
    indexes: ['products'],
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [algolia],
  dashboards: {
    search: defineDashboard({
      widgets: {
        searches: {
          kind: 'timeseries',
          title: 'Daily searches',
          window: '30d',
          metric: defineMetric({
            connector: algolia,
            shape: 'metric',
            name: 'algolia_search_count',
            fn: 'sum',
          }),
        },
        noResultRate: {
          kind: 'stat',
          title: 'No-result rate',
          window: '7d',
          metric: defineMetric({
            connector: algolia,
            shape: 'metric',
            name: 'algolia_no_results_rate',
            fn: 'avg',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

The Analytics API is rate limited per application; 429 responses are retried automatically with exponential backoff by the shared HTTP client.

## Limitations

- Click-through rate and average click position require Click & Conversion Analytics to be enabled on the index; without it those series return empty or zero.
- Top-queries and no-result-queries are aggregated over the whole sync window and stamped at the last day of the window, not per calendar day.
- Per-query click-through rate is not exposed by the top-searches endpoint, so the top-queries series carries search count and result count (nbHits) only.
- Analytics data retention depends on your Algolia plan; requesting a lookback window longer than your retention returns empty days.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Algolia API docs](https://www.algolia.com/doc/rest-api/analytics/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
