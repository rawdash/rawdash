import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const calCom = {
  name: 'cal-com',
  connectorId: 'cal-com',
  config: {
    apiKey: secret('CAL_API_KEY'),
  },
};

export default defineConfig({
  connectors: [calCom],
  dashboards: {
    scheduling: defineDashboard({
      widgets: {
        bookings_30d: {
          kind: 'stat',
          title: 'Bookings (30d)',
          window: '30d',
          metric: defineMetric({
            connector: calCom,
            shape: 'event',
            name: 'cal_com_booking',
            fn: 'count',
          }),
        },
        bookings_per_day: {
          kind: 'timeseries',
          title: 'Bookings per day',
          window: '30d',
          granularity: 'day',
          metric: defineMetric({
            connector: calCom,
            shape: 'event',
            name: 'cal_com_booking',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
