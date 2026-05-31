import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const intercom = {
  name: 'intercom',
  connectorId: 'intercom',
  config: {
    accessToken: secret('INTERCOM_ACCESS_TOKEN'),
    region: 'us',
    apiVersion: '2.11',
  },
};

export default defineConfig({
  connectors: [intercom],
  dashboards: {
    support: defineDashboard({
      widgets: {
        open_conversations: {
          kind: 'stat',
          title: 'Open conversations',
          metric: defineMetric({
            connector: intercom,
            shape: 'entity',
            entityType: 'intercom_conversation',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'open' }],
          }),
        },
      },
    }),
  },
});
