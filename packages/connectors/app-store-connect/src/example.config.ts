import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const appStoreConnect = {
  name: 'app-store-connect',
  connectorId: 'app-store-connect',
  config: {
    issuerId: '69a6de7f-0000-0000-0000-000000000000',
    keyId: 'ABC1234DEF',
    privateKey: secret('APPSTORECONNECT_P8'),
    vendorNumber: '85912345',
  },
};

export default defineConfig({
  connectors: [appStoreConnect],
  dashboards: {
    mobile: defineDashboard({
      widgets: {
        app_count: {
          kind: 'stat',
          title: 'Apps',
          metric: defineMetric({
            connector: appStoreConnect,
            shape: 'entity',
            entityType: 'app_store_connect_app',
            fn: 'count',
          }),
        },
        installs_total: {
          kind: 'stat',
          title: 'Installs (synced window)',
          metric: defineMetric({
            connector: appStoreConnect,
            shape: 'metric',
            name: 'app_store_connect_app_installs',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
