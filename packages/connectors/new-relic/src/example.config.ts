import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const newRelic = {
  name: 'newrelic',
  connectorId: 'new-relic',
  config: {
    apiKey: secret('NEWRELIC_USER_KEY'),
    accountId: 1234567,
    region: 'US' as const,
    nrqlQueries: [
      {
        name: 'error_rate',
        query:
          'SELECT percentage(count(*), WHERE error IS true) FROM Transaction TIMESERIES 5 minutes',
      },
    ],
  },
};

export default defineConfig({
  connectors: [newRelic],
  dashboards: {
    observability: defineDashboard({
      widgets: {
        open_violations: {
          kind: 'stat',
          title: 'Open Alert Violations',
          metric: defineMetric({
            connector: newRelic,
            shape: 'event',
            name: 'newrelic_alert_violation',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'CREATED' }],
          }),
        },
      },
    }),
  },
});
