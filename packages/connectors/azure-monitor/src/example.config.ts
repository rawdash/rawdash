import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const azureMonitor = {
  name: 'azure-monitor',
  connectorId: 'azure-monitor',
  config: {
    tenantId: '00000000-0000-0000-0000-000000000000',
    clientId: '00000000-0000-0000-0000-000000000000',
    clientSecret: secret('AZ_CLIENT_SECRET'),
    subscriptionId: '00000000-0000-0000-0000-000000000000',
    metricQueries: [
      {
        id: 'vm_cpu',
        resourceUri:
          '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/web-01',
        metricNamespace: 'Microsoft.Compute/virtualMachines',
        metric: 'Percentage CPU',
        aggregation: 'Average' as const,
        interval: 'PT1H' as const,
      },
    ],
  },
};

export default defineConfig({
  connectors: [azureMonitor],
  dashboards: {
    infrastructure: defineDashboard({
      widgets: {
        vm_cpu: {
          kind: 'timeseries',
          title: 'VM CPU (avg, 1h)',
          window: '24h',
          metric: defineMetric({
            connector: azureMonitor,
            shape: 'metric',
            name: 'Microsoft.Compute/virtualMachines/Percentage CPU',
            fn: 'avg',
          }),
        },
      },
    }),
  },
});
