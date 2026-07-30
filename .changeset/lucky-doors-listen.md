---
'@rawdash/connector-postgres': minor
---

Add `@rawdash/connector-postgres` — the first query-runner connector. Instead of mirroring a fixed API, it runs the read-only SQL you declare in `queries` against your own PostgreSQL database and projects each result set into storage by `shape`: `stat` (one sample per sync), `timeseries` (one sample per row), `distribution` (one sample per group) or `entities` (one entity per row). Authenticates with a connection string secret; every query runs inside a `READ ONLY` transaction with a `statement_timeout` and a row ceiling, and SQL that isn't a single read-only statement is rejected at config-parse time. Queries referencing `$1`/`$2` get the sync window bound to them for incremental syncs. See `docs/rfcs/0001-query-runner-connectors.md`.
