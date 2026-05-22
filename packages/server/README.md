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
  lastError: string | null;
}
```

Transitions:

- `idle → queued → running → succeeded` (happy path; cloud may use `queued`, OSS skips it)
- `running → failed` (sets `lastError`)
- Any terminal state can transition back to `queued` / `running` on the next trigger.

Clients (`@rawdash/client`) poll `/sync/state` and wait for `!isSyncActive(status)` to settle.

## Engine without HTTP

```ts
import { createEngine } from '@rawdash/server';

const engine = createEngine(config, { storage });
const widgets = await engine.getWidgets('engineering');
const state = await engine.getSyncState();
```

`createEngine` exposes the same shape as the handlers but bypasses HTTP entirely — useful for jobs, CLI tools, or the MCP server.

## Storage

Provide any `ServerStorage` implementation:

- `InMemoryStorage` (re-exported here) — dev/test.
- [`@rawdash/adapter-libsql`](https://www.npmjs.com/package/@rawdash/adapter-libsql) — durable libSQL/Turso/SQLite backend.
- Roll your own by implementing the [`ServerStorage`](https://github.com/rawdash/rawdash/blob/main/packages/core/src/server-storage.ts) interface.

## Links

- [rawdash docs](https://rawdash.dev)
- [`@rawdash/hono`](https://www.npmjs.com/package/@rawdash/hono) — Hono adapter
- [`@rawdash/client`](https://www.npmjs.com/package/@rawdash/client) — typed HTTP client
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
