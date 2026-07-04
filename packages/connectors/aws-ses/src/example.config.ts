import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const awsSes = {
  name: 'aws-ses',
  connectorId: 'aws-ses',
  config: {
    region: 'us-east-1',
    accessKeyId: secret('AWS_ACCESS_KEY_ID'),
    secretAccessKey: secret('AWS_SECRET_ACCESS_KEY'),
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [awsSes],
  dashboards: {
    email: defineDashboard({
      widgets: {
        sends_30d: {
          kind: 'stat',
          title: 'Emails sent (last 30d)',
          metric: defineMetric({
            connector: awsSes,
            shape: 'metric',
            name: 'ses_email_stats',
            fn: 'sum',
            filter: [
              { field: 'kind', op: 'eq', value: 'sends' },
              { field: 'configurationSet', op: 'eq', value: 'all' },
            ],
          }),
        },
      },
    }),
  },
});
