---
'@rawdash/adapter-libsql': patch
'@rawdash/core': patch
---

Make `EntityQuery.type` optional and let `queryEntities` tolerate a type-less query. Previously `StorageHandle.queryEntities` applied `.where('type', '=', q.type)` unconditionally, so omitting `type` (e.g. `queryEntities({})`) passed `undefined` to the libsql driver and crashed with `TypeError: undefined cannot be passed as argument to the database`. This was inconsistent with `queryEvents`/`queryMetrics`, which guard their optional filter and return all rows when it is omitted. `queryEntities` now applies the `type` filter only when provided, returning all entities for the connector otherwise, across the libsql adapter and `InMemoryStorage`.
