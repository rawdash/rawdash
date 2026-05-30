import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const posthog = {
  name: 'posthog',
  connectorId: 'posthog',
  config: {
    apiKey: secret('POSTHOG_API_KEY'),
    projectId: '12345',
    host: 'https://us.posthog.com',
    events: ['pageview', 'signup'],
  },
};

export default defineConfig({
  connectors: [posthog],
  dashboards: {
    product: defineDashboard({
      widgets: {
        daily_events: {
          kind: 'timeseries',
          title: 'Events per day',
          window: '30d',
          metric: defineMetric({
            connector: posthog,
            shape: 'metric',
            name: 'posthog_events_per_day',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
