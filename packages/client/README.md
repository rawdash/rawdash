# @rawdash/client

[![npm version](https://img.shields.io/npm/v/@rawdash/client)](https://www.npmjs.com/package/@rawdash/client)
[![license](https://img.shields.io/npm/l/@rawdash/client)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Framework-agnostic data sources for rawdash dashboards.

## What it is

`@rawdash/client` provides two data source factories — `inProcess` and `http` — that let you wire up rawdash widget data in any JavaScript environment. Use `inProcess` when the rawdash engine runs in the same process as your app (e.g. a Next.js route handler), and `http` when it runs as a separate service.

Both return the same `DataSource` interface, so you can swap between them without changing the rest of your code.

## Install

```sh
npm install @rawdash/client
```

## Quick example

```ts
import { inProcess, http } from '@rawdash/client';

// Option A — engine runs in the same process
import { engine } from './rawdash-engine';
const source = inProcess(engine);

// Option B — engine runs as a separate HTTP service
const source = http({
  baseUrl: 'https://rawdash.example.com',
  apiKey: process.env.RAWDASH_API_KEY,
});

// Same API either way
const widget = await source.getWidget('engineering', 'open_prs');
const widgets = await source.getWidgets('engineering');
const health = await source.getHealth(); // {status:'ok'} — liveness only
const syncState = await source.getSyncState(); // current sync progress
await source.triggerSync(); // returns immediately with {queued: boolean}

// Wait for fresh data:
// - if a sync is in-flight, waits for it to settle
// - if data is stale, triggers a sync and waits for it
// - if data is fresh, returns immediately
await source.ensureFresh(5 * 60 * 1000); // max age 5 minutes
```

## API

### `inProcess(engine, options?): DataSource`

Wraps an in-process rawdash engine. Zero network overhead.

| Option               | Type     | Default | Description                           |
| -------------------- | -------- | ------- | ------------------------------------- |
| `syncTimeoutMs`      | `number` | `30000` | How long `ensureFresh` waits for sync |
| `syncPollIntervalMs` | `number` | `500`   | Delay between sync-state polls        |

### `http(options): DataSource`

Creates an HTTP client pointing at a rawdash server.

| Option               | Type           | Default            | Description                           |
| -------------------- | -------------- | ------------------ | ------------------------------------- |
| `baseUrl`            | `string`       | —                  | Base URL of the rawdash server        |
| `apiKey`             | `string`       | —                  | Bearer token for authentication       |
| `timeoutMs`          | `number`       | `5000`             | Per-request timeout in milliseconds   |
| `syncTimeoutMs`      | `number`       | `30000`            | How long `ensureFresh` waits for sync |
| `syncPollIntervalMs` | `number`       | `500`              | Delay between sync-state polls        |
| `fetch`              | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation           |

### `DataSource`

```ts
interface DataSource {
  getWidget(dashboardId: string, widgetId: string): Promise<CachedWidget>;
  getWidgets(dashboardId: string): Promise<CachedWidget[]>;

  // Liveness probe — {status:'ok'}. No storage access.
  getHealth(): Promise<HealthResponse>;

  // Current sync state: idle | queued | running | succeeded | failed,
  // plus queuedAt / startedAt / lastSyncAt / lastError.
  getSyncState(): Promise<SyncState>;

  // Triggers a sync. Returns {queued: true|false} immediately —
  // the sync runs in the background.
  triggerSync(): Promise<TriggerSyncResponse>;

  // Waits until data is at most maxAgeMs old. Returns true if a sync
  // ran, false if data was already fresh. Throws on sync failure.
  ensureFresh(maxAgeMs?: number): Promise<boolean>;
}
```

## How `ensureFresh` works

The client polls `/sync/state` (not `/health` — see [wire contract](../server#the-wire-contract)) and walks the state machine:

1. Get the current `SyncState`.
2. If `status` is `queued` or `running`, wait for it to settle. Return `true` on `succeeded`, throw on `failed`.
3. Otherwise check `lastSyncAt`. If it's within `maxAgeMs`, return `false`.
4. Otherwise call `POST /sync`, then poll `/sync/state` until it settles.
5. If the server returns an unrecognized `status`, **throw immediately** — turns silent contract mismatches into fast, debuggable errors instead of 30s deadlocks.

Tune `syncTimeoutMs` for long-running connectors.

## Links

- [rawdash docs](https://rawdash.dev)
- [`@rawdash/server`](../server) — wire contract reference
- [`@rawdash/hono`](../hono) — Hono adapter for the server side
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
