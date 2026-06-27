# @rawdash/adapter-sqlite

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
