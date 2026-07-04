import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const calendly = {
  name: 'calendly',
  connectorId: 'calendly',
  config: {
    apiToken: secret('CALENDLY_API_TOKEN'),
    organizationUri: 'https://api.calendly.com/organizations/AAAAAAAAAAAAAAAA',
  },
};

export default defineConfig({
  connectors: [calendly],
  dashboards: {
    scheduling: defineDashboard({
      widgets: {
        bookings_30d: {
          kind: 'stat',
          title: 'Bookings (30d)',
          window: '30d',
          metric: defineMetric({
            connector: calendly,
            shape: 'event',
            name: 'calendly_scheduled_event',
            fn: 'count',
          }),
        },
        bookings_per_day: {
          kind: 'timeseries',
          title: 'Bookings per day',
          window: '30d',
          granularity: 'day',
          metric: defineMetric({
            connector: calendly,
            shape: 'event',
            name: 'calendly_scheduled_event',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
