import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const vertexAi = {
  name: 'vertexAi',
  connectorId: 'vertex-ai',
  config: {
    projectId: 'my-project-123',
    serviceAccountJson: secret('GCP_SA_JSON'),
    bqProject: 'my-billing-project',
    bqDataset: 'billing_export',
    bqLocation: 'US',
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [vertexAi],
  dashboards: {
    ai: defineDashboard({
      widgets: {
        invocations: {
          kind: 'stat',
          title: 'Invocations (24h)',
          metric: defineMetric({
            connector: vertexAi,
            shape: 'metric',
            name: 'vertex_ai_invocations',
            fn: 'sum',
          }),
        },
        spend: {
          kind: 'timeseries',
          title: 'Vertex AI spend',
          window: '30d',
          metric: defineMetric({
            connector: vertexAi,
            shape: 'metric',
            name: 'vertex_ai_spend',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
