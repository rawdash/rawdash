import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const circleci = {
  name: 'circleci',
  connectorId: 'circleci',
  config: {
    apiToken: secret('CIRCLECI_API_TOKEN'),
    projectSlugs: ['gh/my-org/my-repo'],
    branch: 'main',
    pipelinesLookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [circleci],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        builds: {
          kind: 'stat',
          title: 'Pipelines run',
          metric: defineMetric({
            connector: circleci,
            shape: 'event',
            name: 'circleci_pipeline_event',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
