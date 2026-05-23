---
'@rawdash/core': patch
'@rawdash/server': patch
'@rawdash/mcp': patch
'@rawdash/hono': patch
---

Make `ServerStorage.markSyncRunning` optional. It's an in-process-only concern: `runSync` calls it to acquire the `queued → running` lock. Deferred-mode storages (where an external runner drives the `running → succeeded/failed` transitions via its own aggregation) may now omit `markSyncRunning` entirely — `runSync` and the MCP `trigger_sync` tool both skip the call when it's absent. In-process storages (`InMemoryStorage`, `LibsqlStorage`) still implement it; no behavior change for in-process users.
