# @rawdash/server

[![npm version](https://img.shields.io/npm/v/@rawdash/server)](https://www.npmjs.com/package/@rawdash/server)
[![license](https://img.shields.io/npm/l/@rawdash/server)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Framework-agnostic rawdash request handlers, sync engine, and wire-contract types. **No HTTP framework dependency** — wrap with [`@rawdash/hono`](https://www.npmjs.com/package/@rawdash/hono) (or another adapter) to serve over HTTP.

## What it is

`@rawdash/server` is the engine half of rawdash:

- The **sync engine** (`runSync`, `createEngine`) that drives connectors and writes to storage.
- **Pure HTTP handlers** (`listWidgets`, `getWidget`, `triggerSync`, `getSyncStateHandler`, `getHealth`, `runRetentionOnce`) — async functions you can call from any framework.
- **`EngineContext`** — the per-request interface adapters use to inject `DashboardConfig` and `ServerStorage`. The handler doesn't care whether those come from a static config or are looked up fresh per request — that decision belongs to the adapter.
- **`ROUTES`** — canonical URL paths, the single source of truth for the wire contract.
- **`RawdashError`** — structured errors with `status` and `code` for adapters to translate.
- The **`SyncState` types** and `InMemoryStorage` (re-exported from `@rawdash/core`).

This package does **not** know about Hono, Express, Node's `http`, or any HTTP framework. Pick an adapter.

## When to use what

| You want to…                                                 | Use                                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Serve rawdash over HTTP in a Hono / Workers / Bun / Deno app | [`@rawdash/hono`](https://www.npmjs.com/package/@rawdash/hono) (depends on `@rawdash/server`) |
| Build a different framework adapter (Express, NestJS, etc.)  | This package directly — wrap the pure handlers                                                |
| Use the engine without HTTP (background job, CLI, MCP)       | This package — `createEngine` / `runSync`                                                     |

## Install

```sh
npm install @rawdash/server
```

## The contract for adapter authors

Each pure handler takes an `EngineContext` (and any path parameters) and returns the response body or throws a `RawdashError`. Your adapter:

1. Routes the HTTP request to the matching handler.
2. Constructs an `EngineContext` from the request — `getConfig` and `getStorage` can return constants or values derived from the request (e.g. read from a database keyed by a path param or auth header).
3. Awaits the handler and serializes the result as JSON.
4. Catches `RawdashError` and maps `status` + `code` to a structured HTTP response.

```ts
import { RawdashError, isRawdashError, listWidgets } from '@rawdash/server';

// example: a hypothetical Express adapter
app.get('/dashboards/:id/widgets', async (req, res) => {
  try {
    const body = await listWidgets(
      {
        getConfig: () => loadConfig(),
        getStorage: () => loadStorage(),
      },
      req.params.id,
    );
    res.json(body);
  } catch (err) {
    if (isRawdashError(err)) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});
```

## The wire contract

| Route                                        | Method | Handler               | Response                                      |
| -------------------------------------------- | ------ | --------------------- | --------------------------------------------- |
| `/health`                                    | GET    | `getHealth`           | `{status:'ok'}` (liveness, no storage access) |
| `/sync/state`                                | GET    | `getSyncStateHandler` | `SyncState`                                   |
| `/sync`                                      | POST   | `triggerSync`         | `{queued: boolean}` — returns immediately     |
| `/dashboards/:dashboardId/widgets`           | GET    | `listWidgets`         | `WidgetsListResponse`                         |
| `/dashboards/:dashboardId/widgets/:widgetId` | GET    | `getWidget`           | `CachedWidget`                                |
| `/retention/retain`                          | POST   | `runRetentionOnce`    | `{triggered: true}` (synchronous)             |

Paths are exported as constants from `ROUTES`. Use them in adapters (and in clients) instead of hard-coding.

### `SyncState`

```ts
type SyncStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';
interface SyncState {
  status: SyncStatus;
  queuedAt: string | null;
  startedAt: string | null;
  lastSyncAt: string | null;
  lastBackfillAt: string | null;
  lastError: string | null;
}
```

Transitions:

- `idle → queued → running → succeeded` (happy path; cloud may use `queued`, OSS skips it)
- `running → failed` (sets `lastError`)
- Any terminal state can transition back to `queued` / `running` on the next trigger.

`lastSyncAt` advances on every successful sync; `lastBackfillAt` advances only when that sync actually re-fetched windowed history (see [Windowed-backfill scheduling](#windowed-backfill-scheduling)). Together they're the opaque blob the engine needs persisted to schedule syncs — storage adapters that implement `ServerStorage` own both columns.

Clients (`@rawdash/sdk-client`) poll `/sync/state` and wait for `!isSyncActive(status)` to settle.

### Windowed-backfill scheduling

Widgets declare fetch windows (a 90d timeseries needs 90 days of history), but most syncs shouldn't re-fetch the whole window every tick — that's permanently heavy. `runSync` asks `@rawdash/core`'s pure [`planSync`](../core/README.md#plansyncinput) helper which mode each sync should run:

- **`full`** — re-fetch windowed history. Chosen on the first sync, or when a widget declares a `requiredWindowMs` and the last windowed backfill is older than the cadence (default 1h, well under any sane window). `planSync` reports `backfillDue: true`, and `runSync` stamps `lastBackfillAt` on success.
- **`latest`** — cheap incremental sync from `lastSyncAt`. Chosen otherwise. `lastBackfillAt` is left untouched.

This keeps windowed widgets fresh without paying the full backfill on every tick, and it's the same decision the hosted product makes — the policy lives in the engine so no integrator has to reinvent it. Connectors don't implement any of this; they just honor the `mode` handed to them (see [Authoring a connector → Modes](../../docs/authoring-a-connector.md#modes)).

### `CachedWidget.syncState`

`listWidgets` and `getWidget` populate `syncState` (and `meta.connectorStatus`) on each `CachedWidget` from the underlying `StorageHandle.getHealth?()`. When storage doesn't implement `getHealth`, `syncState` falls back to `'unsynced'` (no data) or `'fresh'` (data exists).

| Value        | Meaning                                                                              |
| ------------ | ------------------------------------------------------------------------------------ |
| `'fresh'`    | Data exists and the connector's `lastSyncAt` is within `2 × syncIntervalSeconds`     |
| `'stale'`    | Data exists but the connector hasn't synced inside its freshness window              |
| `'unsynced'` | No successful sync yet for this connector                                            |
| `'syncing'`  | A sync is actively in progress for the connector backing this widget                 |
| `'failing'`  | Connector is in `error` / `auth_failed` / `paused` — surface a reauthorize CTA in UI |

Storage adapters implement `getHealth?(): Promise<ConnectorHealth | null>` per `StorageHandle` to expose `status`, `lastSyncAt`, `lastError`, and `syncIntervalSeconds`. `InMemoryStorage` provides a minimal implementation (last-write time as `lastSyncAt`, `syncIntervalSeconds: 0`); adapters with first-class per-connector status (e.g. cloud, libSQL) populate it richly.

### `triggerSync` modes

`triggerSync(ctx, opts?)` accepts an optional `opts.mode`:

- **`'in-process'`** (default): the handler records the `queued` transition and then fires `runSync(config, storage)` as a background promise that iterates `config.connectors`. Right for self-hosted, single-process OSS deployments.
- **`'deferred'`**: the handler only records the `queued` transition. `runSync` is not invoked, and `getConfig` is not called (and may be omitted from `ctx`). The `running → succeeded/failed` transitions are the responsibility of an external runner — typically a queue consumer worker that decrypts credentials, applies retries, and drives storage directly.

```ts
// Self-hosted, in-process (default):
await triggerSync({ getConfig, getStorage });

// Queue-backed runner:
await triggerSync({ getStorage }, { mode: 'deferred' });
```

In deferred mode, the wire response is unchanged: `{queued: true}` if `markSyncQueued()` accepted the transition, `{queued: false}` if a sync was already active.

## Engine without HTTP

```ts
import { createEngine } from '@rawdash/server';

const engine = createEngine(config, { storage });
const widgets = await engine.getWidgets('engineering');
const state = await engine.getSyncState();
```

`createEngine` exposes the same shape as the handlers but bypasses HTTP entirely — useful for jobs, CLI tools, or the MCP server.

## Widget cache (optional)

`listWidgets` and `getWidget` accept an optional `WidgetCache` so deployments can avoid hitting storage for every widget on every request:

```ts
import type { WidgetCache } from '@rawdash/server';

class LruWidgetCache implements WidgetCache {
  private store = new Map<string, { value: CachedWidget; expiresAt: number }>();
  async get({ dashboardId, widgetId }) {
    const hit = this.store.get(`${dashboardId}/${widgetId}`);
    if (!hit || hit.expiresAt < Date.now()) return undefined;
    return hit.value;
  }
  async set({ dashboardId, widgetId, widget }, value) {
    const ttlMs = ttlForWidget(widget); // e.g. derive from connector syncIntervalSeconds
    this.store.set(`${dashboardId}/${widgetId}`, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }
}

const cache = new LruWidgetCache();
await listWidgets(ctx, 'engineering', cache);
```

The cache impl owns TTL, eviction, and the backing store (LRU, KV, Redis…). If `cache` is omitted, behavior is identical to the no-cache path. Errors thrown from `cache.get` fall through to a fresh resolution; errors from `cache.set` are logged via `console.warn` and do not affect the response.

`@rawdash/hono`'s `createWidgetsRouter` accepts a `cache: (c: Context) => WidgetCache` factory invoked once per request, so the cache can be scoped to the request's tenant/auth context.

## Storage

Provide any `ServerStorage` implementation:

- `InMemoryStorage` (re-exported here) — dev/test.
- [`@rawdash/adapter-libsql`](https://www.npmjs.com/package/@rawdash/adapter-libsql) — durable libSQL/Turso/SQLite backend.
- Roll your own by implementing the [`ServerStorage`](https://github.com/rawdash/rawdash/blob/main/packages/core/src/server-storage.ts) interface.

`markSyncRunning` is optional on `ServerStorage`. It's an in-process-only concern: `runSync` calls it to acquire the `queued → running` lock so two concurrent in-process syncs can't trample each other. Deferred-mode storages (where an external runner drives the `running → succeeded/failed` transitions via its own aggregation) may omit `markSyncRunning` entirely — `runSync` skips the call when it's absent.

## Links

- [rawdash docs](https://rawdash.dev)
- [`@rawdash/hono`](https://www.npmjs.com/package/@rawdash/hono) — Hono adapter
- [`@rawdash/sdk-client`](https://www.npmjs.com/package/@rawdash/sdk-client) — typed HTTP client
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
