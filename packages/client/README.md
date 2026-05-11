# @rawdash/client

[![npm version](https://img.shields.io/npm/v/@rawdash/client)](https://www.npmjs.com/package/@rawdash/client)
[![license](https://img.shields.io/npm/l/@rawdash/client)](LICENSE)

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
const health = await source.getHealth();
await source.triggerSync();

// Wait for fresh data (triggers sync if stale, then polls until idle)
await source.ensureFresh(5 * 60 * 1000); // max age 5 minutes
```

## API

### `inProcess(engine): DataSource`

Wraps an in-process rawdash engine. Zero network overhead — all calls go directly to the engine's in-memory state.

### `http(options): DataSource`

Creates an HTTP client pointing at a rawdash server. Options:

| Option      | Type           | Default            | Description                         |
| ----------- | -------------- | ------------------ | ----------------------------------- |
| `baseUrl`   | `string`       | —                  | Base URL of the rawdash server      |
| `apiKey`    | `string`       | —                  | Bearer token for authentication     |
| `timeoutMs` | `number`       | `5000`             | Per-request timeout in milliseconds |
| `fetch`     | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation         |

### `DataSource`

Both factories return the same `DataSource` interface:

```ts
interface DataSource {
  getWidget(
    dashboardId: string,
    widgetId: string,
  ): Promise<CachedWidgetResponse>;
  getWidgets(dashboardId: string): Promise<CachedWidgetResponse[]>;
  getHealth(): Promise<HealthResponse>;
  triggerSync(): Promise<SyncTriggerResponse>;
  ensureFresh(maxAgeMs?: number): Promise<boolean>;
}
```

## Links

- [rawdash docs](https://rawdash.dev)
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
