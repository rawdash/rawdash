import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const gcpMonitoring = {
  name: 'gcpMonitoring',
  connectorId: 'gcp-monitoring',
  config: {
    projectId: 'my-project-123',
    serviceAccountJson: secret('GCP_MONITORING_SA_JSON'),
    metricQueries: [
      {
        id: 'gce_cpu',
        metricType: 'compute.googleapis.com/instance/cpu/utilization',
        alignmentPeriod: '300s',
        perSeriesAligner: 'ALIGN_MEAN',
      },
    ],
    lookbackMinutes: 180,
  },
};

export default defineConfig({
  connectors: [gcpMonitoring],
  dashboards: {
    infra: defineDashboard({
      widgets: {
        cpu: {
          kind: 'timeseries',
          title: 'GCE CPU utilization',
          window: '24h',
          metric: defineMetric({
            connector: gcpMonitoring,
            shape: 'metric',
            name: 'compute.googleapis.com/instance/cpu/utilization',
            fn: 'avg',
          }),
        },
      },
    }),
  },
});
