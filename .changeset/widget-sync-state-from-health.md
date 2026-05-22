---
'@rawdash/core': minor
'@rawdash/server': minor
---

Populate `CachedWidget.syncState` and `CachedWidget.meta` from per-connector health.

`WidgetSyncState` is now `'fresh' | 'stale' | 'unsynced' | 'syncing' | 'failing'` — the previous `'synced'` / `'error'` variants are gone (they were declared in the wire types but never populated, so no consumer should depend on them).

`StorageHandle` gains an optional `getHealth?(): Promise<ConnectorHealth | null>` accessor, and `ConnectorHealth` is exported from `@rawdash/core` and re-exported from `@rawdash/server`. `resolveWidget` calls it to derive `syncState` and `meta.connectorStatus` per widget, falling back to `fresh|unsynced` from the resolved data when health is absent. `CachedWidget.cachedAt` is now sourced from the connector's `lastSyncAt` instead of the global `SyncState.lastSyncAt`.

`InMemoryStorage` implements `getHealth()` with a minimal shape — `lastSyncAt` is the last write timestamp per connector, `syncIntervalSeconds: 0`. Cloud / libSQL adapters that track per-connector status can implement `getHealth()` to surface rich `failing` / `syncing` states; adapters that don't implement it keep the previous behavior (no `syncState`/`meta`).
