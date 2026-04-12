# @rawdash/server

Standalone Hono HTTP server for Rawdash. Accepts a connector config, runs the sync engine in-process, and exposes a REST API for widget data.

## Installation

```sh
pnpm add @rawdash/server
```

## Usage

### `serve(config, options?)`

Starts the HTTP server on Node.js.

```ts
import { githubConnector } from '@rawdash/connector-github';
import { serve } from '@rawdash/server';

serve({
  connectors: [
    {
      connector: githubConnector,
      config: { token: process.env.GITHUB_TOKEN },
    },
  ],
});
```

### `createServer(config)`

Returns the Hono app without binding to a port. Use this when you need the app object directly (e.g. to deploy to Cloudflare Workers, Deno, Bun, etc.).

```ts
import { createServer } from '@rawdash/server';

const app = createServer({ connectors: [] });
export default app;
```

## Options

| Option | Type     | Default | Description       |
| ------ | -------- | ------- | ----------------- |
| `port` | `number` | `8080`  | Port to listen on |

## API

### `GET /widgets`

Returns all cached widget entries.

```json
[
  {
    "id": "github:pull_requests",
    "connectorId": "github",
    "widgetId": "pull_requests",
    "data": [...],
    "cachedAt": "2026-04-11T10:00:00.000Z"
  }
]
```

### `GET /widgets/:id`

Returns a single widget by composite ID (`connectorId:widgetId`). Returns `404` if not found.

```json
{
  "id": "github:pull_requests",
  "connectorId": "github",
  "widgetId": "pull_requests",
  "data": [...],
  "cachedAt": "2026-04-11T10:00:00.000Z"
}
```

### `POST /sync`

Triggers an immediate sync across all configured connectors. Returns `triggered: false` if a sync is already in progress.

```json
{ "triggered": true }
```

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
