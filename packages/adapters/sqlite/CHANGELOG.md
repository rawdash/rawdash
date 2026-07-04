# @rawdash/adapter-sqlite

## 0.29.2

### Patch Changes

- Updated dependencies [5761126]
- Updated dependencies [88c2d08]
- Updated dependencies [58a1086]
- Updated dependencies [708f22d]
- Updated dependencies [322664c]
- Updated dependencies [f0a1c55]
- Updated dependencies [8106c27]
- Updated dependencies [1aba313]
  - @rawdash/core@0.29.2
  - @rawdash/adapter-libsql@0.29.2

## 0.29.1

### Patch Changes

- d83f3eb: Add an engine-owned applier for `RetentionDeletionPlan`. `@rawdash/server` now exports `applyRetention(storage, connectorId, plan)`, the missing "apply" half of `@rawdash/core`'s `computeRetention`: it deletes exactly the rows the plan names across all four shapes — events (`name`+`start_ts`+`attributes`), metrics and distributions (`name`+`ts`+`attributes`), and **entities** (`type`+`id`) — via targeted, deduped, batched deletes and returns the actual `{ rowsDeleted }`. It owns the table/column/`attributes`-serialization details internally, so consumers no longer hand-roll the plan → DELETE translation (or silently delete nothing when a key column or the attribute encoding changes). Backed by a new optional `deleteByIdentity` primitive on `StorageHandle`, implemented in the in-memory and libSQL/SQLite adapters and byte-matching how each adapter serializes `attributes`. Existing `runRetention` / `runRetentionOnce` semantics are unchanged.
- Updated dependencies [d83f3eb]
  - @rawdash/core@0.29.1
  - @rawdash/adapter-libsql@0.29.1

## 0.29.0

### Patch Changes

- 48283df: Move windowed-backfill scheduling into the engine. `@rawdash/core` now exports a pure `planSync` helper that decides, from a connector's declared fetch windows and when its history was last refreshed, whether a sync should run `full` (re-fetching windowed history) or `latest` (cheap incremental), and flags `backfillDue` so callers know when to stamp the connector's persisted `lastBackfillAt`. The decision is per-connector: `ServerStorage` gains optional `getConnectorSyncState` / `markConnectorSyncSucceeded` methods (backed by a new `connector_sync_state` table in the libSQL/SQLite adapters), so a connector added long after the first sync still backfills its window instead of inheriting another connector's "already caught up" state. The self-hosted `runSync` now plans each connector with `planSync` instead of always syncing `full`, so it stops being permanently heavy while keeping windowed widgets fresh on a default 1h cadence.
- Updated dependencies [48283df]
- Updated dependencies [8eb995a]
  - @rawdash/core@0.29.0
  - @rawdash/adapter-libsql@0.29.0

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2
- @rawdash/adapter-libsql@0.28.2

## 0.28.1

### Patch Changes

- 8d02825: Add an optional `replaceWindow` to `StorageHandle.metrics()` and `StorageHandle.distributions()`. When provided (`{ start, end }`, inclusive on both bounds), only rows for the scoped names whose `ts` falls inside the window are deleted before the new samples are inserted, instead of replacing the full history for those names. Omitting `replaceWindow` keeps the existing full delete-by-name behavior, so this is fully backward compatible. This lets connectors that re-pull only a partial window refresh just that window without wiping previously retained history.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1
  - @rawdash/adapter-libsql@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0
  - @rawdash/adapter-libsql@0.28.0

## 0.27.0

### Patch Changes

- @rawdash/core@0.27.0
- @rawdash/adapter-libsql@0.27.0

## 0.26.0

### Patch Changes

- @rawdash/core@0.26.0
- @rawdash/adapter-libsql@0.26.0

## 0.25.0

### Patch Changes

- f99cb16: Expose a per-widget `status` in the widgets API, and make connector health a required storage capability

  `CachedWidget` now carries a `status` field (plus optional `errorMessage`), computed at read time and stored in whatever cache implementation is injected (in-memory, KV, etc.):
  - `ok` — the metric resolved against matching underlying rows (including a legitimate aggregated `0`, where rows existed but summed/counted to zero).
  - `no_data` — the query matched **zero** underlying rows for the referenced resource. Distinct from a genuine aggregated `0`, so silent-empty widgets stop rendering as healthy zeros. Only reported once the connector has synced at least once (`syncState` `fresh`/`stale`).
  - `error` — **any** widget sync error: the connector reports a failure (health `status` `error`/`auth_failed`, or any non-null `lastError`), or the metric compute threw. A connector error takes precedence over a compute error; the underlying message is surfaced in `errorMessage`.

  **Breaking — connector health moved to the `ServerStorage` interface.** Health is a read/serving concern derived from sync state, not a per-connector write concern, so:
  - `ServerStorage` now requires `getHealth(connectorId): Promise<ConnectorHealth | null>`.
  - The optional `StorageHandle.getHealth?()` has been **removed** (it was the wrong layer and silently absent in most storages — a failed sync never surfaced as a widget error).

  Any custom `ServerStorage` implementation (e.g. a cloud-injected storage) must add `getHealth`. The first-party storages already do: `InMemoryStorage` and the libsql/sqlite adapters derive it from their sync state, reporting a failed sync as a connector `error` with its `lastError`.

  New in `@rawdash/core`: `computeMetricWithStatus` (returns `{ value, matchedRows }`) alongside `computeMetric`; the `WidgetStatus` type; and `healthStatusFromSyncStatus`. The `@rawdash/hono` widgets router carries the new fields through the response payload unchanged.

- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0
  - @rawdash/adapter-libsql@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0
  - @rawdash/adapter-libsql@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0
  - @rawdash/adapter-libsql@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0
  - @rawdash/adapter-libsql@0.22.0

## 0.21.1

### Patch Changes

- @rawdash/core@0.21.1
- @rawdash/adapter-libsql@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0
  - @rawdash/adapter-libsql@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0
  - @rawdash/adapter-libsql@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0
  - @rawdash/adapter-libsql@0.19.0

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0
- @rawdash/adapter-libsql@0.18.0

## 0.17.0

### Patch Changes

- @rawdash/core@0.17.0
- @rawdash/adapter-libsql@0.17.0

## 0.16.0

### Minor Changes

- afb68a9: New `@rawdash/adapter-sqlite` package — file-backed SQLite `ServerStorage` for
  local OSS development. Thin wrapper over `@rawdash/adapter-libsql` that points
  libSQL at a local file (creates the parent directory automatically). Default
  storage in the example-nextjs dev server — survives restarts, no more cold
  syncs on every file change. Set `RAWDASH_STORAGE=memory` to opt back into
  in-memory storage.

### Patch Changes

- Updated dependencies [422b711]
- Updated dependencies [79fdd64]
- Updated dependencies [a1c4c66]
- Updated dependencies [074ec25]
- Updated dependencies [022cbf1]
- Updated dependencies [e104540]
- Updated dependencies [9169ceb]
- Updated dependencies [5026a5b]
- Updated dependencies [c27c332]
- Updated dependencies [e8b014a]
- Updated dependencies [7060534]
- Updated dependencies [d52a6a8]
- Updated dependencies [d17a523]
  - @rawdash/core@0.16.0
  - @rawdash/adapter-libsql@0.16.0
