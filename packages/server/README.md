# @rawdash/server

[![npm version](https://img.shields.io/npm/v/@rawdash/server)](https://www.npmjs.com/package/@rawdash/server)
[![license](https://img.shields.io/npm/l/@rawdash/server)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Standalone Hono HTTP server hosting the rawdash data API.

## What it is

`@rawdash/server` takes a rawdash config, runs the sync engine in-process, and exposes a REST API for widget data. Deploy it as a standalone service alongside your frontend, or use `createServer` to get the raw Hono app and deploy it to any JS runtime (Cloudflare Workers, Bun, Deno, etc.).

## Install

```sh
npm install @rawdash/server
```

## Quick example

```ts
import { GitHubActionsConnector } from '@rawdash/connector-github';
import { defineConfig, defineDashboard, secret } from '@rawdash/core';
import { serve } from '@rawdash/server';

const github = new GitHubActionsConnector({
  owner: 'my-org',
  repo: 'my-repo',
  token: secret('GITHUB_TOKEN'),
});

serve(
  defineConfig({
    connectors: [{ connector: github }],
    dashboards: {
      engineering: defineDashboard({ widgets: {} }),
    },
  }),
  { port: 8080 },
);
```

## API

### `serve(config, options?)`

Starts the HTTP server on Node.js (via `@hono/node-server`). Options:

| Option    | Type            | Default   | Description                            |
| --------- | --------------- | --------- | -------------------------------------- |
| `port`    | `number`        | `8080`    | Port to listen on                      |
| `storage` | `ServerStorage` | in-memory | Storage backend (e.g. `LibsqlStorage`) |

### `createServer(config, options?)`

Returns the Hono app without binding to a port. Use when you need the app object directly.

```ts
import { createServer } from '@rawdash/server';

const app = createServer(config);
export default app; // deploy to Cloudflare Workers, Bun, Deno, etc.
```

## HTTP endpoints

### `GET /dashboards/:dashboardId/widgets`

Returns all cached widget entries for a dashboard.

```json
[
  {
    "id": "github:pull_requests",
    "connectorId": "github",
    "widgetId": "pull_requests",
    "data": [],
    "cachedAt": "2026-04-11T10:00:00.000Z"
  }
]
```

### `GET /dashboards/:dashboardId/widgets/:widgetId`

Returns a single widget by ID. Returns `404` if not found.

### `POST /sync`

Triggers an immediate sync across all configured connectors. Returns `{ "triggered": false }` if a sync is already in progress.

### `GET /health`

Returns the current sync state.

```json
{
  "status": "idle",
  "lastSyncAt": "2026-04-11T10:00:00.000Z",
  "lastError": null
}
```

`status` is one of `"idle"`, `"syncing"`, or `"error"`.

## Links

- [rawdash docs](https://rawdash.dev)
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
