<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-product-hunt

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-product-hunt)](https://www.npmjs.com/package/@rawdash/connector-product-hunt)
[![license](https://img.shields.io/npm/l/@rawdash/connector-product-hunt)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Product Hunt launches as entities and daily vote, comment, and rank snapshots as metrics, for launch-day velocity and post-launch rank trajectory widgets.

## Install

```sh
npm install @rawdash/connector-product-hunt
```

## Authentication

A Product Hunt API access token, sent as a bearer token on every GraphQL request. A non-expiring developer token is enough for the read-only access this connector needs.

1. Sign in to Product Hunt and open the API dashboard at https://www.producthunt.com/v2/oauth/applications.
2. Create an application (or open an existing one) and copy its developer token. Alternatively, exchange your client id and secret at https://api.producthunt.com/v2/oauth/token with grant_type=client_credentials for a client-level read-only token.
3. Store the token as a secret and reference it from the connector config as `apiToken: secret("PRODUCT_HUNT_API_TOKEN")`.

## Configuration

| Field          | Type   | Required | Description                                                                                                                         |
| -------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apiToken`     | secret | Yes      | Product Hunt API access token. A developer token from the Product Hunt API dashboard works for read-only access.                    |
| `slugs`        | array  | No       | Track specific launches by slug (the last path segment of a Product Hunt post URL). Omit to sync every post in the lookback window. |
| `topic`        | string | No       | Restrict the feed sync to a single Product Hunt topic slug. Ignored when specific post slugs are configured.                        |
| `lookbackDays` | number | No       | How many days of launches to fetch on a full sync when no post slugs are configured. Defaults to 30.                                |
| `resources`    | array  | No       | Which Product Hunt resources to sync. Omit to sync all of them.                                                                     |

## Resources

- **`product_hunt_post`** _(entity)_ - Product Hunt launches with their name, tagline, counters, ranks, and launch timestamps.
  - Endpoint: `GraphQL query: posts { nodes { ... } } / post(slug:) { ... }`
  - `slug`: URL slug of the launch.
  - `name`: Product name.
  - `tagline`: One-line pitch shown on the listing.
  - `description`: Longer product description.
  - `votesCount`: Upvotes at the time of the sync.
  - `commentsCount`: Comments at the time of the sync.
  - `reviewsCount`: Number of reviews.
  - `reviewsRating`: Average review rating.
  - `dailyRank`: Rank on its launch day, or null when not featured.
  - `weeklyRank`: Rank for its launch week, or null when not featured.
  - `topics`: Topic names attached to the launch.
  - `url`: Product Hunt listing URL.
  - `website`: Product website URL.
  - `createdAt`: Post creation time (epoch ms).
  - `featuredAt`: Time the post was featured (epoch ms), or null.
- **`product_hunt_post_metrics`** _(metric)_ - Daily snapshot of the vote, comment, review, and rank counters of each tracked launch. The metric value is the upvote count.
  - Endpoint: `GraphQL query: posts { nodes { ... } } / post(slug:) { ... }`
  - Unit: votes
  - Granularity: day
  - Dimensions: `date`, `postId`, `slug`, `postName`
  - Measures: `votes`, `comments`, `reviews`, `reviewsRating`, `dailyRank`, `weeklyRank`
  - The API exposes current counters only, so each sample is a snapshot taken at sync time and bucketed into the UTC day it was taken. Samples for the current day are replaced on every sync, so re-syncing is idempotent; earlier days are preserved.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const productHunt = {
  name: 'product-hunt',
  connectorId: 'product-hunt',
  config: {
    apiToken: secret('PRODUCT_HUNT_API_TOKEN'),
    slugs: ['rawdash'],
  },
};

export default defineConfig({
  connectors: [productHunt],
  dashboards: {
    launch: defineDashboard({
      widgets: {
        upvotes: {
          kind: 'stat',
          title: 'Upvotes',
          window: '1d',
          metric: defineMetric({
            connector: productHunt,
            shape: 'metric',
            name: 'product_hunt_post_metrics',
            field: 'value',
            fn: 'max',
          }),
        },
        upvote_trajectory: {
          kind: 'timeseries',
          title: 'Upvote trajectory',
          window: '30d',
          metric: defineMetric({
            connector: productHunt,
            shape: 'metric',
            name: 'product_hunt_post_metrics',
            field: 'value',
            fn: 'max',
          }),
        },
        comments: {
          kind: 'stat',
          title: 'Comments',
          window: '1d',
          metric: defineMetric({
            connector: productHunt,
            shape: 'metric',
            name: 'product_hunt_post_metrics',
            field: 'comments',
            fn: 'max',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

The GraphQL endpoint meters a complexity budget of 6250 points per 15 minutes rather than a fixed request count. The connector requests a small fixed field set and pages 20 posts at a time to stay well inside the budget; the shared HTTP client backs off on 429 responses.

## Limitations

- Vote and comment history is not exposed by the API, so metric samples are snapshots taken at sync time and bucketed per UTC day. Velocity is derived from successive syncs - a day with no sync has no sample.
- Only one sample per post per UTC day is retained; a later sync on the same day replaces the earlier one.
- Ranks come straight from the API (dailyRank, weeklyRank) and are null for posts that were never featured.
- Comment bodies, votes, collections, and maker profiles are out of scope; only post-level counters are synced.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Product Hunt API docs](https://api.producthunt.com/v2/docs)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
