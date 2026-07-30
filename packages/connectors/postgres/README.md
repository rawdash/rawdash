<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-postgres

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-postgres)](https://www.npmjs.com/package/@rawdash/connector-postgres)
[![license](https://img.shields.io/npm/l/@rawdash/connector-postgres)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Run declared read-only SQL against your own PostgreSQL database and turn the result rows into dashboard metrics or entities - no separate metrics endpoint to build.

> **Cost & frequency.** Every sync runs each declared query against your production database. Keep the SQL aggregate-only and indexed, and raise the sync interval rather than the statement timeout if queries get heavy.

## Install

```sh
npm install @rawdash/connector-postgres
```

## Authentication

A PostgreSQL connection string. Point it at a dedicated role with SELECT-only grants; every query additionally runs inside a READ ONLY transaction with a statement timeout.

1. Create a dedicated read-only role: `CREATE ROLE rawdash_readonly LOGIN PASSWORD '…';`
2. Grant it read access to the tables the dashboard needs: `GRANT USAGE ON SCHEMA public TO rawdash_readonly; GRANT SELECT ON ALL TABLES IN SCHEMA public TO rawdash_readonly;`
3. Allow the role to reach the database from wherever rawdash syncs run (VPC peering, an allowlisted egress IP, or a connection proxy).
4. Store the connection URI as a secret and reference it from config as `connectionString: secret("PG_CONNECTION_STRING")`.
5. Declare one entry in `queries` per number you want on a dashboard.

## Configuration

| Field                | Type    | Required | Description                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectionString`   | secret  | Yes      | PostgreSQL connection URI for a read-only role, e.g. postgres://readonly:password@host:5432/app. Store it as a secret.                                                                                                                                                                                                                                           |
| `ssl`                | boolean | No       | Connect over TLS. Defaults to true unless the connection string already says otherwise (sslmode=disable) or the host is localhost.                                                                                                                                                                                                                               |
| `queries`            | array   | Yes      | The SQL to run on every sync. Each entry needs an id, a read-only single-statement SQL query, and a shape (`stat`, `timeseries`, `distribution`, or `entities`) that decides how the result rows are projected into storage. Optional `columns` remaps the expected column names, and `name` overrides the metric name / entity type (defaults to the query id). |
| `statementTimeoutMs` | number  | No       | Server-side statement timeout applied to every query. Defaults to 15000. A per-query `statementTimeoutMs` overrides it.                                                                                                                                                                                                                                          |
| `maxRowsPerQuery`    | number  | No       | Row ceiling per query; a query returning more rows fails instead of silently truncating. Defaults to 5000. A per-query `maxRows` overrides it.                                                                                                                                                                                                                   |
| `lookbackDays`       | number  | No       | How far back the sync window starts when the host does not supply a since bound, for queries that reference the $1 window-start placeholder. Defaults to 30.                                                                                                                                                                                                     |

## Resources

- **`<query id>`** _(metric)_ - One metric series per declared query whose shape is `stat`, `timeseries`, or `distribution`. The series name is the query `name` (defaulting to its id), so the actual keys depend on the configured `queries`. A `stat` query contributes one sample per sync (building history over time), a `timeseries` query one sample per result row at that row timestamp, and a `distribution` query one sample per group at the sync time.
  - Endpoint: `SQL (SELECT, in a READ ONLY transaction)`
  - Dimensions: `queryId`, `series`
  - Each sync replaces only the timestamp span it rewrites (replaceWindow), so history outside the current window survives an incremental sync.
- **`<query id> (entities)`** _(entity)_ - One entity per result row for declared queries whose shape is `entities`. The entity type is the query `name` (defaulting to its id) and the id comes from the row `id` column; every other column becomes an attribute. Each sync replaces the full set of rows for that type.
  - Endpoint: `SQL (SELECT, in a READ ONLY transaction)`

## Example

```ts
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
```

## Rate limits

There is no upstream rate limit; the cost control is your own database. Every query runs with a statement timeout (15s by default) and a row ceiling, and the connector runs one query at a time on a single connection.

## Limitations

- Queries must be a single read-only statement starting with SELECT, WITH, TABLE, or VALUES. The connector both rejects write keywords at config-parse time and runs every query in a READ ONLY transaction; it is not a substitute for a role with SELECT-only grants.
- Only one numeric per metric sample. A metric-shaped query projects one column into `value` plus an optional group label into the `series` dimension; use the `entities` shape when a row carries several numbers you want to keep together.
- There is no per-query schedule. The host decides sync cadence for the connector as a whole (see planSync), so all queries run on every sync tick.
- Incremental syncs are opt-in per query: reference $1 (window start) and optionally $2 (window end) in the SQL and the connector binds the sync window to them. A query without placeholders is re-run in full on every sync.
- A query returning more rows than the row ceiling fails rather than silently truncating, so a widget never shows a half-computed number.
- Result columns are projected by convention (`ts`/`bucket`, `value`/`count`/`total`, `series`/`label`, `id`, `updated_at`) with an optional per-query `columns` override; arbitrary column-to-attribute mapping beyond that is out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [PostgreSQL API docs](https://node-postgres.com/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
