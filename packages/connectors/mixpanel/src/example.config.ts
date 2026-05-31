import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const mixpanel = {
  name: 'mixpanel',
  connectorId: 'mixpanel',
  config: {
    username: 'rawdash-reader.abcdef.mp-service-account',
    secret: secret('MIXPANEL_SECRET'),
    projectId: '1234567',
    events: ['Signed Up', 'Purchase'],
    activeUserEvent: 'Signed Up',
    retentionEvent: 'Signed Up',
    funnels: [{ id: 42, name: 'Signup to Purchase' }],
  },
};

export default defineConfig({
  connectors: [mixpanel],
  dashboards: {
    growth: defineDashboard({
      widgets: {
        dau: {
          kind: 'timeseries',
          title: 'Daily Active Users',
          window: '30d',
          metric: defineMetric({
            connector: mixpanel,
            shape: 'metric',
            name: 'mixpanel_dau',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
