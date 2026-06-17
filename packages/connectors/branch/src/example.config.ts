import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const branch = {
  name: 'branch',
  connectorId: 'branch',
  config: {
    branchKey: secret('BRANCH_KEY'),
    branchSecret: secret('BRANCH_SECRET'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [branch],
  dashboards: {
    mobile: defineDashboard({
      widgets: {
        installs_30d: {
          kind: 'stat',
          title: 'Branch installs (30d)',
          window: '30d',
          metric: defineMetric({
            connector: branch,
            shape: 'metric',
            name: 'branch_install_metrics',
            field: 'value',
            fn: 'sum',
          }),
        },
        daily_installs: {
          kind: 'timeseries',
          title: 'Daily installs by channel',
          window: '30d',
          metric: defineMetric({
            connector: branch,
            shape: 'metric',
            name: 'branch_install_metrics',
            field: 'value',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
