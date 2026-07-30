# RFC 0001 — Query-runner connectors

- **Status**: accepted
- **Tracking**: RAW-441 (PostgreSQL), RAW-442 (MySQL), RAW-443 (Snowflake), RAW-444 (BigQuery)
- **Supersedes nothing.** Extends the connector-as-resource-syncer model (RAW-18) rather than replacing it.

## Summary

Every connector shipped so far mirrors a SaaS API: the connector author knows the
endpoints, declares the resources, and the user supplies credentials plus a bit of
scoping. A database is not that. There is no fixed set of resources to mirror — the
interesting numbers live in the user's own schema, and only the user knows which ones
they are.

A **query-runner connector** inverts the resource declaration: the user declares the
resources, as SQL. Everything else — the `Connector` interface, the storage shapes,
the sync cadence, secrets, logging — stays exactly as it is.

## Motivation

The rawdash ICP already has the numbers they want on a dashboard sitting in Postgres:
signups, orders, revenue, DAU, queue depth. Today, surfacing those means building a
metrics endpoint and pointing a generic HTTP connector at it. That is a project. This
model turns it into a config entry.

## The model

```ts
{
  connectionString: secret('PG_CONNECTION_STRING'),
  queries: [
    { id: 'signups_total',   shape: 'stat',         sql: 'select count(*) as value from users' },
    { id: 'signups_per_day', shape: 'timeseries',   sql: '… group by 1' },
    { id: 'orders_by_status', shape: 'distribution', sql: '… group by 1' },
    { id: 'top_accounts',    shape: 'entities',     sql: 'select id, name, mrr from accounts …' },
  ],
}
```

### Resources are dynamic, and the roster is per-instance

The connector declares two `dynamic: true` resources (one `metric`, one `entity`) and
writes under names taken from the config: `name ?? id` per query. This is the same
device AWS CloudWatch, Datadog, GCP Monitoring, Azure Monitor and New Relic already use
for user-declared metric queries — `dynamic` tells the shape-conformance harness that
undeclared names of that shape are expected. Nothing new is required from core.

Widget `source` strings therefore reference the user's own query ids
(`postgres:signups_per_day`), and two queries may not resolve to the same name — the
config schema rejects that at parse time.

### Result rows project into the existing shapes

| `shape`        | Rows in                      | Written as                                                         |
| -------------- | ---------------------------- | ------------------------------------------------------------------ |
| `stat`         | one row, one numeric         | one metric sample per sync, stamped at sync time (history accrues) |
| `timeseries`   | `(ts, value[, series])` rows | one metric sample per row at the row's timestamp                   |
| `distribution` | `(label, value)` rows        | one metric sample per group, all stamped at sync time              |
| `entities`     | `(id, …)` rows               | one entity per row; other columns become attributes                |

Columns are matched by convention (`ts`/`bucket`/`day`/`date`, `value`/`count`/`total`/
`amount`, `series`/`label`/`group`, `id`, `updated_at`), with a per-query `columns`
override. A single-column result is treated as the value column whatever it is named.

This keeps the **metric-shape contract** intact: the primary numeric always lands in
`value`, and the only attributes emitted are the two declared dimensions — `queryId`
and `series`. Multi-numeric rows are deliberately _not_ supported as metrics; that is
what the `entities` shape is for.

### Safety is enforced twice, in the database and at parse time

The database enforcement is the one that counts:

- every query runs inside `BEGIN READ ONLY`, rolled back afterwards, so a write that
  slipped past everything else fails with `25006 read_only_sql_transaction`;
- `SET LOCAL statement_timeout` bounds every query server-side;
- the query is wrapped as `select * from (<sql>) as rawdash_query limit N+1`, and a
  result that hits `N+1` **fails the query** rather than silently truncating — a
  half-computed number on a dashboard is worse than a visibly broken widget.

On top of that, `configFields` rejects SQL that isn't a single read-only statement:
comments, string literals and dollar-quoted blocks are stripped, then the statement
must start with `SELECT`/`WITH`/`TABLE`/`VALUES`, must not contain a second statement,
and must not contain a write keyword anywhere (which is what catches data-modifying
CTEs — `with x as (delete from … returning id) select …` passes a leading-keyword check
but not this one). The keyword list is deliberately narrow, covering nestable writers
and DDL, so that ordinary column names (`deleted_at`, `regexp_replace`, a column called
`comment`) don't trip it.

None of this replaces a read-only role. The documentation leads with `CREATE ROLE …`
plus `GRANT SELECT`; the layers above are for the case where someone points the
connector at a superuser connection string anyway.

### Cadence stays with the engine

The ticket sketched a per-query `schedule`. This RFC drops it. `planSync` in
`@rawdash/core` already decides `full` vs `latest` per tick from the widgets that exist,
and a second scheduler inside the connector would fight it and silently change what
"sync interval" means for this one connector. All queries run on every tick.

Incremental syncs are opt-in per query instead, through positional parameters: a query
that references `$1` gets the sync window start bound to it, and `$2` the window end.
A query with no placeholders is a full recompute every tick — correct, just more work.
Metric writes pass `replaceWindow` spanning only the samples being rewritten, so a
narrow incremental window cannot delete history outside it.

### Failure handling

Queries are independent, so one broken query does not cost the whole sync: each failure
is logged as a `warn`, the remaining queries still run and write, and the first error is
rethrown at the end so the run is correctly marked failed. Driver errors map onto the
existing typed errors — `AuthError` for `28xxx`/`42501` (credential replaced by the
user), `TransientError` for connection loss, cancellation and `too many connections`,
`ClientBugError` for bad SQL and for a write blocked by the read-only transaction.
That is what lets the connector lifecycle work in core classify a query-runner failure
the same way it classifies an HTTP one.

## Package layout

`packages/connectors/query-runner-shared` (private, bundled into consumers via tsup
`noExternal`, mirroring `aws-shared`/`gcp-shared`/`azure-shared`) owns everything that
is not driver-specific: the query-definition schema and shared config shape, the SQL
guard, row projection, and the `runQueries` orchestrator. A driver package supplies one
thing:

```ts
interface QueryExecutor {
  run(
    request: QueryRequest,
    signal?: AbortSignal,
  ): Promise<readonly QueryRow[]>;
  close(): Promise<void>;
}
```

`@rawdash/connector-postgres` implements it over `pg`. MySQL, Snowflake and BigQuery
(RAW-442/443/444) are each an executor plus that driver's config fields and error map;
the config surface, projection rules and safety guarantees come for free. BigQuery adds
a bytes-billed cap and Snowflake a warehouse-tuned timeout default as executor-level
config — the shared layer takes per-query `statementTimeoutMs`/`maxRows` overrides so
neither needs to fork the model.

## Alternatives considered

**A generic "HTTP endpoint returning rows" connector.** Doesn't remove the work; it
moves it into an endpoint the user still has to build and secure.

**Static resources per shape** (`postgres_stat`, `postgres_timeseries`, …) with the query
id as a dimension. Widget definitions would then all point at the same series and filter
by `queryId`, which reads badly and makes retention/replace scopes coarser than they need
to be. Dynamic names cost nothing and are already an established pattern.

**Letting a query emit several measures.** Rejected for now: declared `measures` are
static per resource, so arbitrary user columns would have to be emitted as undeclared
attributes, which the metric conformance harness correctly rejects. `entities` covers
the multi-number case.
