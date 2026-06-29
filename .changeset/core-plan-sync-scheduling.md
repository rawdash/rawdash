---
'@rawdash/core': minor
'@rawdash/server': patch
'@rawdash/adapter-libsql': patch
'@rawdash/adapter-sqlite': patch
---

Move windowed-backfill scheduling into the engine. `@rawdash/core` now exports a pure `planSync` helper that decides, from a connector's declared fetch windows and when its history was last refreshed, whether a sync should run `full` (re-fetching windowed history) or `latest` (cheap incremental), and flags `backfillDue` so callers know when to stamp the connector's persisted `lastBackfillAt`. The decision is per-connector: `ServerStorage` gains optional `getConnectorSyncState` / `markConnectorSyncSucceeded` methods (backed by a new `connector_sync_state` table in the libSQL/SQLite adapters), so a connector added long after the first sync still backfills its window instead of inheriting another connector's "already caught up" state. The self-hosted `runSync` now plans each connector with `planSync` instead of always syncing `full`, so it stops being permanently heavy while keeping windowed widgets fresh on a default 1h cadence.
