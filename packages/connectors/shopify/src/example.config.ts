import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const shopify = {
  name: 'shopify',
  connectorId: 'shopify',
  config: {
    shopDomain: 'yourshop.myshopify.com',
    accessToken: secret('SHOPIFY_ACCESS_TOKEN'),
  },
};

export default defineConfig({
  connectors: [shopify],
  dashboards: {
    sales: defineDashboard({
      widgets: {
        paid_orders: {
          kind: 'stat',
          title: 'Paid orders',
          metric: defineMetric({
            connector: shopify,
            shape: 'entity',
            entityType: 'shopify_order',
            fn: 'count',
            filter: [{ field: 'financialStatus', op: 'eq', value: 'PAID' }],
          }),
        },
      },
    }),
  },
});
