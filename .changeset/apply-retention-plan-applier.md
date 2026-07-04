---
'@rawdash/server': patch
'@rawdash/core': patch
'@rawdash/adapter-libsql': patch
'@rawdash/adapter-sqlite': patch
---

Add an engine-owned applier for `RetentionDeletionPlan`. `@rawdash/server` now exports `applyRetention(storage, connectorId, plan)`, the missing "apply" half of `@rawdash/core`'s `computeRetention`: it deletes exactly the rows the plan names across all four shapes — events (`name`+`start_ts`+`attributes`), metrics and distributions (`name`+`ts`+`attributes`), and **entities** (`type`+`id`) — via targeted, deduped, batched deletes and returns the actual `{ rowsDeleted }`. It owns the table/column/`attributes`-serialization details internally, so consumers no longer hand-roll the plan → DELETE translation (or silently delete nothing when a key column or the attribute encoding changes). Backed by a new optional `deleteByIdentity` primitive on `StorageHandle`, implemented in the in-memory and libSQL/SQLite adapters and byte-matching how each adapter serializes `attributes`. Existing `runRetention` / `runRetentionOnce` semantics are unchanged.
