---
'@rawdash/core': minor
'@rawdash/server': patch
'@rawdash/adapter-libsql': patch
'@rawdash/adapter-sqlite': patch
---

Move windowed-backfill scheduling into the engine. `@rawdash/core` now exports a pure `planSync` helper that decides, from a connector's declared fetch windows and when its history was last refreshed, whether a sync should run `full` (re-fetching windowed history) or `latest` (cheap incremental), and flags `backfillDue` so callers know when to stamp their persisted `lastBackfillAt`. The persisted sync state (`SyncState`) gains a `lastBackfillAt` field, and `markSyncSucceeded` accepts a `{ backfillDue }` option that records it. The self-hosted `runSync` now uses `planSync` instead of always syncing `full`, so it stops being permanently heavy while still keeping windowed widgets fresh on a default 1h cadence.
