import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const postgres = {
  name: 'postgres',
  connectorId: 'postgres',
  config: {
    connectionString: secret('PG_CONNECTION_STRING'),
    queries: [
      {
        id: 'signups_total',
        shape: 'stat',
        sql: 'select count(*) as value from users',
      },
      {
        id: 'signups_per_day',
        shape: 'timeseries',
        sql: `select date_trunc('day', created_at) as ts, count(*) as value
              from users
              where created_at >= $1 and created_at < $2
              group by 1
              order by 1`,
      },
      {
        id: 'orders_by_status',
        shape: 'distribution',
        sql: 'select status as series, count(*) as value from orders group by 1',
      },
    ],
  },
};

export default defineConfig({
  connectors: [postgres],
  dashboards: {
    product: defineDashboard({
      widgets: {
        signups: {
          kind: 'stat',
          title: 'Total signups',
          metric: defineMetric({
            connector: postgres,
            shape: 'metric',
            name: 'signups_total',
            fn: 'latest',
          }),
        },
        signups_trend: {
          kind: 'timeseries',
          title: 'Signups per day',
          window: '30d',
          granularity: 'day',
          metric: defineMetric({
            connector: postgres,
            shape: 'metric',
            name: 'signups_per_day',
            fn: 'sum',
          }),
        },
        orders_by_status: {
          kind: 'distribution',
          title: 'Orders by status',
          window: '24h',
          metric: [
            defineMetric({
              connector: postgres,
              shape: 'metric',
              name: 'orders_by_status',
              fn: 'latest',
              label: 'Paid',
              filter: [{ field: 'series', op: 'eq', value: 'paid' }],
            }),
            defineMetric({
              connector: postgres,
              shape: 'metric',
              name: 'orders_by_status',
              fn: 'latest',
              label: 'Refunded',
              filter: [{ field: 'series', op: 'eq', value: 'refunded' }],
            }),
          ],
        },
      },
    }),
  },
});
