---
'@rawdash/adapter-libsql': patch
'@rawdash/core': patch
---

Add `storage.rekeyConnectorId(from, to)` to the libSQL adapter so the engine owns the canonical set of connector-keyed tables. Renaming/rekeying a connector while preserving its data is a generic storage operation: it rewrites `connector_id` across every connector-keyed table in a single batched `UPDATE OR IGNORE`, returning `{ rowsAffected }`. The table set is derived from and compile-time-checked against the adapter's schema (exported as `CONNECTOR_KEYED_TABLES`), so it can no longer drift as new connector-keyed tables are added. `ServerStorage` gains an optional `rekeyConnectorId` method and a `RekeyConnectorResult` type in `@rawdash/core`.
