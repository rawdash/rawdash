# @rawdash/hono

[![npm version](https://img.shields.io/npm/v/@rawdash/hono)](https://www.npmjs.com/package/@rawdash/hono)
[![license](https://img.shields.io/npm/l/@rawdash/hono)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Hono adapter for rawdash. Mounts [`@rawdash/server`](https://www.npmjs.com/package/@rawdash/server) handlers as Hono routers — runtime-agnostic, so it works in Cloudflare Workers, Node, Bun, Deno, or anywhere Hono runs.

## What it is

A thin wrapper around `@rawdash/server`'s pure handlers. Each factory returns a `Hono` app you mount with `app.route('/path', router)`. You provide:

- **`getConfig(c)`** and **`getStorage(c)`** — per-request functions that the adapter calls to obtain the `DashboardConfig` and `ServerStorage` for the request. Return constants for the simple case, or derive values from `c` (path params, auth headers, env bindings) when each request needs its own config or storage.
- **`before`** middleware — typically auth and authorization checks.

No business logic lives here — every router delegates to a `@rawdash/server` handler and translates `RawdashError` into structured HTTP responses.

## Install

```sh
npm install @rawdash/hono hono
```

Hono is a peer dependency.

## Quick start

The `mountEngine` helper builds a fully-wired Hono app for the simple case (one config, one storage):

```ts
import { createClient } from '@libsql/client';
import { LibsqlStorage } from '@rawdash/adapter-libsql';
import { mountEngine } from '@rawdash/hono';

const storage = new LibsqlStorage({
  client: createClient({ url: 'file:rawdash.db' }),
});
const { app } = mountEngine(config, { storage });

// Cloudflare Worker / Bun / Deno: export the app
export default app;

// Node: use @hono/node-server
// import { serve } from '@hono/node-server';
// serve({ fetch: app.fetch, port: 8080 });
```

This mounts:

| Path                                     | Method | Source                  |
| ---------------------------------------- | ------ | ----------------------- |
| `/health`                                | GET    | `createHealthRouter`    |
| `/sync/state`                            | GET    | `createSyncStateRouter` |
| `/sync`                                  | POST   | `createSyncRouter`      |
| `/dashboards/:dashboardId/widgets[/...]` | GET    | `createWidgetsRouter`   |
| `/retention/retain`                      | POST   | `createRetentionRouter` |

`mountEngine` also starts a background retention loop on long-lived runtimes; pass `{ startRetention: false }` on serverless and trigger retention via your platform's scheduler instead.

## Per-request config and storage — compose factories directly

For deployments that need auth or that look up config / storage per request, skip `mountEngine` and compose the factories. Each factory accepts `before` middleware that runs before the handler, plus the `getConfig` / `getStorage` callbacks:

```ts
import {
  createHealthRouter,
  createSyncRouter,
  createSyncStateRouter,
  createWidgetsRouter,
} from '@rawdash/hono';
import { Hono } from 'hono';

import { assertScope, requireAuth } from './my-auth';
import { loadConfig, loadStorage } from './my-loaders';

const app = new Hono();

app.route('/health', createHealthRouter()); // public liveness probe

const authedApp = new Hono();
authedApp.use('*', requireAuth);

authedApp.route(
  '/dashboards',
  createWidgetsRouter({
    before: [assertScope('widgets:read')],
    getConfig: (c) => loadConfig(c),
    getStorage: (c) => loadStorage(c),
  }),
);

authedApp.route(
  '/sync',
  createSyncRouter({
    before: [assertScope('widgets:write')],
    getConfig: (c) => loadConfig(c),
    getStorage: (c) => loadStorage(c),
  }),
);

authedApp.route(
  '/sync/state',
  createSyncStateRouter({
    before: [assertScope('widgets:read')],
    getStorage: (c) => loadStorage(c),
  }),
);

app.route('/', authedApp);
export default app;
```

The pure handlers in `@rawdash/server` do all the work; this package only translates HTTP. Adapters in other frameworks (Express, NestJS, etc.) would be a parallel thin layer over the same handlers.

## Deferred sync mode (queue-backed runners)

By default `createSyncRouter` runs the sync **in-process**: the handler records the `queued` transition and then kicks off `runSync(config, storage)` as a background promise that iterates `config.connectors`.

For deployments where the actual sync work runs **out-of-process** — typically a queue/worker setup where credentials, retries, and rate-limit budgets live in a separate runtime — pass `mode: 'deferred'`. The trigger handler then only persists the `queued` transition; the `running → succeeded/failed` transitions become the storage's responsibility, driven by the external runner:

```ts
authedApp.route(
  '/sync',
  createSyncRouter({
    mode: 'deferred',
    before: [assertScope('widgets:write')],
    getStorage: (c) => loadStorage(c),
    // getConfig can be omitted in deferred mode — useful when you can't
    // materialize OSS-format Connector instances at request time.
  }),
);
```

In deferred mode:

- `runSync` is **never** invoked by the trigger handler.
- `getConfig` is optional and never called.
- `markSyncQueued` is called exactly as in in-process mode; its return value drives the `{queued: true|false}` response.
- Your external worker is responsible for calling `markSyncRunning`, `markSyncSucceeded`, and `markSyncFailed` on the same storage.

## Running on Node

`@rawdash/hono` does **not** depend on `@hono/node-server` — the package stays runtime-agnostic so a Workers bundle doesn't pull Node-specific code. To run on Node, add `@hono/node-server` yourself:

```sh
npm install @hono/node-server
```

```ts
import { serve } from '@hono/node-server';
import { mountEngine } from '@rawdash/hono';

const { app } = mountEngine(config);
serve({ fetch: app.fetch, port: 8080 });
```

## Error mapping

Handler errors translate to JSON:

- `RawdashError` → `{ error: message, code }` at `err.status` (e.g. 404 `{error:'Dashboard not found', code:'DASHBOARD_NOT_FOUND'}`).
- Other errors propagate to Hono's `onError` for you to handle.

## Links

- [rawdash docs](https://rawdash.dev)
- [`@rawdash/server`](https://www.npmjs.com/package/@rawdash/server) — pure handlers + engine (the package this wraps)
- [`@rawdash/client`](https://www.npmjs.com/package/@rawdash/client) — typed HTTP client (speaks the same wire contract)
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
