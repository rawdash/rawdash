<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-hacker-news

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-hacker-news)](https://www.npmjs.com/package/@rawdash/connector-hacker-news)
[![license](https://img.shields.io/npm/l/@rawdash/connector-hacker-news)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Watch Hacker News for submissions of your domain and mentions of your product in comments - points, comments, and current front-page rank.

## Install

```sh
npm install @rawdash/connector-hacker-news
```

## Authentication

None. Hacker News data is read through the public Algolia HN Search API, which needs no API key or account.

1. Set `watchedDomains` to the domains you want to track submissions for (e.g. `["rawdash.dev"]`).
2. Optionally set `watchedQueries` to product/brand terms to track story and comment mentions.
3. No secret is required.

## Configuration

| Field                 | Type   | Required | Description                                                                                                                                                                                                         |
| --------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `watchedDomains`      | array  | No       | Domains to watch for Hacker News submissions (e.g. "rawdash.dev"). Any story whose URL host matches one of these is tracked. At least one watched domain or watched query is required.                              |
| `watchedQueries`      | array  | No       | Free-text terms to watch. Each term matches story titles/text (submissions) and comment bodies (mentions). At least one watched domain or watched query is required.                                                |
| `resources`           | array  | No       | Which resources to sync. Omit to sync all. 'submission_metrics' rides the 'submissions' fetch - enabling it writes a daily points/comments snapshot per submission. 'mentions' requires at least one watched query. |
| `lookbackDays`        | number | No       | How many days back to fetch submissions and mentions on a full sync. Defaults to 90.                                                                                                                                |
| `metricsRefreshDays`  | number | No       | On an incremental sync, submissions created within this many days are re-fetched so their points/comments snapshot and current rank stay fresh. Defaults to 30.                                                     |
| `pollIntervalMinutes` | number | No       | Scheduling hint for how often to sync. Defaults to 15; sync more aggressively while a submission is on the front page. Consumed by the scheduler, not the sync itself.                                              |

## Resources

- **`hn_submission`** _(entity)_ - Hacker News story submissions matching a watched domain or query, with current points, comment count, author, and submission time.
  - Endpoint: `GET /api/v1/search_by_date?tags=story`
  - Fetched newest-first from the Algolia HN Search API, bounded by the lookback window on full sync and the refresh window on incremental sync. Domain matches are confirmed against the parsed URL host.
  - `title`: Submission title.
  - `url`: Submitted URL, or null for text posts.
  - `author`: Submitter username.
  - `points`: Current score at last sync.
  - `comments`: Current comment count at last sync.
  - `createdAt`: Submission time (epoch ms).
- **`hn_submission_metric`** _(metric)_ - Daily snapshot of a watched submission: its score (value), comment count, and current front-page rank. One sample per submission per sync day.
  - Endpoint: `GET /api/v1/search_by_date?tags=story`
  - Unit: points
  - Granularity: day
  - Dimensions: `submissionId`, `title`, `url`, `author`
  - Measures: `comments`, `currentRank`
  - The primary numeric (value) is the story score. Only today's samples are replaced on each sync, so prior days accumulate into a trajectory.
- **`hn_mention`** _(entity)_ - Hacker News comments whose text matches a watched query, linked to the story they were posted under.
  - Endpoint: `GET /api/v1/search_by_date?tags=comment`
  - Requires at least one watched query; there is no domain-scoped comment search.
  - `author`: Comment author username.
  - `text`: Comment body (HTML as returned).
  - `storyId`: Id of the story the comment is under.
  - `storyTitle`: Title of that story.
  - `query`: The watched query that matched.
  - `createdAt`: Comment time (epoch ms).

## Example

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

const hackerNews = {
  name: 'hacker-news',
  connectorId: 'hacker-news',
  config: {
    watchedDomains: ['rawdash.dev'],
    watchedQueries: ['rawdash'],
    pollIntervalMinutes: 15,
  },
};

export default defineConfig({
  connectors: [hackerNews],
  dashboards: {
    marketing: defineDashboard({
      widgets: {
        submissions_tracked: {
          kind: 'stat',
          title: 'Submissions tracked',
          metric: defineMetric({
            connector: hackerNews,
            shape: 'entity',
            entityType: 'hn_submission',
            fn: 'count',
          }),
        },
        top_score: {
          kind: 'stat',
          title: 'Top submission score',
          metric: defineMetric({
            connector: hackerNews,
            shape: 'entity',
            entityType: 'hn_submission',
            field: 'points',
            fn: 'max',
          }),
        },
        mentions_this_week: {
          kind: 'stat',
          title: 'Comment mentions (7d)',
          metric: defineMetric({
            connector: hackerNews,
            shape: 'entity',
            entityType: 'hn_mention',
            fn: 'count',
            window: '7d',
          }),
        },
        points_trajectory: {
          kind: 'timeseries',
          title: 'Points trajectory',
          window: '30d',
          granularity: 'day',
          metric: defineMetric({
            connector: hackerNews,
            shape: 'metric',
            name: 'hn_submission_metric',
            field: 'value',
            fn: 'max',
            groupBy: { field: 'ts', granularity: 'day' },
          }),
        },
      },
    }),
  },
});
```

## Rate limits

The Algolia HN Search API allows roughly 10,000 requests/hour per IP unauthenticated. This connector paginates sequentially at 100 hits per page and caps each search term at 20 pages.

## Limitations

- Points and comment counts are point-in-time snapshots; Hacker News exposes no historical trajectory, so the metric history accumulates one daily sample per submission going forward from first sync.
- Current front-page rank is only available while a submission sits on the front page (top ~90); it is null otherwise.
- Comment mentions are matched by free-text query only - there is no per-domain comment search.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Hacker News API docs](https://hn.algolia.com/api)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
