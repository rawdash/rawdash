---
'@rawdash/core': minor
'@rawdash/server': minor
'@rawdash/hono': minor
'@rawdash/client': minor
'@rawdash/nextjs': minor
'@rawdash/adapter-libsql': minor
'@rawdash/mcp': minor
'@rawdash/cli': minor
'@rawdash/connector-github': minor
'@rawdash/connector-google-analytics': minor
'@rawdash/connector-linear': minor
'@rawdash/connector-stripe': minor
---

**Breaking.** Redesigned the sync/health wire contract and split `@rawdash/server` into a framework-agnostic core (pure handlers, engine, types) and a new `@rawdash/hono` adapter package.

### Wire contract (breaking)

- `GET /health` now returns `{status: 'ok'}` — liveness only, no storage access.
- New `GET /sync/state` returns the sync projection (the data `/health` used to return).
- `POST /sync` returns `{queued: true|false}` immediately; it never blocks waiting for the sync to finish.
- `SyncState.status` is now `'idle' | 'queued' | 'running' | 'succeeded' | 'failed'`, with new `queuedAt` and `startedAt` fields. (Was: `'idle' | 'syncing' | 'error'`.)

Migrate clients to poll `/sync/state` instead of `/health`. `@rawdash/client.ensureFresh` does this automatically.

### Package changes (breaking)

- `@rawdash/server` no longer depends on Hono. It exports pure handler functions (`listWidgets`, `getWidget`, `triggerSync`, `getSyncStateHandler`, `getHealth`, `runRetentionOnce`), an `EngineContext` interface, `ROUTES` constants, the `RawdashError` class, and the engine (`createEngine`, `runSync`, `runRetention`). `serve()` is gone.
- **New `@rawdash/hono` package** — Hono router factories (`createWidgetsRouter`, `createSyncRouter`, `createSyncStateRouter`, `createHealthRouter`, `createRetentionRouter`) and a `mountEngine` convenience. This is the only package with a `hono` dependency now, and it ships no Node-specific code.
- `ServerStorage` methods renamed: `setSyncing` → `markSyncRunning`, `setSyncSuccess` → `markSyncSucceeded`, `setSyncError` → `markSyncFailed`. New `markSyncQueued()` method.
- `@rawdash/client` data sources gained `getSyncState()`. `getHealth()` now returns `{status:'ok'}` only. `ensureFresh` polls `/sync/state` and throws fast on unrecognized status values (no more 30s deadlocks on contract mismatches).

### Migration

Replace `import { serve } from '@rawdash/server'` with:

```ts
import { serve as honoServe } from '@hono/node-server';
import { mountEngine } from '@rawdash/hono';

const { app } = mountEngine(config, { storage });
honoServe({ fetch: app.fetch, port: 8080 });
```

Replace storage method calls:

```ts
// before
await storage.setSyncing();
await storage.setSyncSuccess();
await storage.setSyncError('boom');

// after
await storage.markSyncRunning();
await storage.markSyncSucceeded();
await storage.markSyncFailed('boom');
```

If you were calling `GET /health` to read sync state, switch to `GET /sync/state`. `@rawdash/client` users get this for free.

### Other

- `@rawdash/adapter-libsql` adds migration `0002_milky_echo` (two `ALTER TABLE ... ADD COLUMN` statements for `queued_at` and `started_at`). Applies automatically on first run; safe on populated databases.
- The libsql migrations bundle script now runs Prettier internally so the output is byte-stable across runs. A new CI step (`pnpm --filter @rawdash/adapter-libsql db:bundle && git diff --exit-code`) catches stale bundles.
- `@rawdash/mcp`'s `trigger_sync` tool uses the new storage methods.
- `@rawdash/nextjs.createRawdashClient` polls `/sync/state` (via the underlying data source) instead of `/health`.
