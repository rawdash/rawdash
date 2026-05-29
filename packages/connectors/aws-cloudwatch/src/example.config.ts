import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const cloudwatch = {
  name: 'cloudwatch',
  connectorId: 'aws-cloudwatch',
  config: {
    region: 'us-east-1',
    accessKeyId: secret('AWS_ACCESS_KEY_ID'),
    secretAccessKey: secret('AWS_SECRET_ACCESS_KEY'),
    metricQueries: [
      {
        id: 'ec2_cpu',
        namespace: 'AWS/EC2',
        metric: 'CPUUtilization',
        stat: 'Average',
        periodSeconds: 300,
        dimensions: { InstanceId: 'i-0123456789abcdef0' },
      },
    ],
  },
};

export default defineConfig({
  connectors: [cloudwatch],
  dashboards: {
    infra: defineDashboard({
      widgets: {
        cpu: {
          kind: 'timeseries',
          title: 'EC2 CPU Utilization',
          window: '24h',
          metric: defineMetric({
            connector: cloudwatch,
            shape: 'metric',
            name: 'AWS/EC2/CPUUtilization',
            fn: 'avg',
          }),
        },
      },
    }),
  },
});
