import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const zendesk = {
  name: 'zendesk',
  connectorId: 'zendesk',
  config: {
    subdomain: 'acme',
    email: 'agent@acme.com',
    apiToken: secret('ZENDESK_API_TOKEN'),
  },
};

export default defineConfig({
  connectors: [zendesk],
  dashboards: {
    support: defineDashboard({
      widgets: {
        open_tickets: {
          kind: 'stat',
          title: 'Open tickets',
          metric: defineMetric({
            connector: zendesk,
            shape: 'entity',
            entityType: 'zendesk_ticket',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'open' }],
          }),
        },
      },
    }),
  },
});
