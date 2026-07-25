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
