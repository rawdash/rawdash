# @rawdash/core

[![npm version](https://img.shields.io/npm/v/@rawdash/core)](https://www.npmjs.com/package/@rawdash/core)
[![license](https://img.shields.io/npm/l/@rawdash/core)](LICENSE)

Headless dashboard backend primitives for rawdash. Define connectors, dashboards, widgets, and metrics — no UI assumptions, works anywhere.

## What it is

`@rawdash/core` is the foundation of the rawdash ecosystem. It provides the types and functions (`defineConfig`, `defineDashboard`, `defineMetric`, `defineConnector`, `secret`) that every rawdash setup is built on. It has no framework dependencies and no I/O — it only models your dashboard configuration and the connector interface.

Other packages (`@rawdash/server`, `@rawdash/nextjs`, `@rawdash/mcp`) take a config produced by this package and add runtime behavior.

## Install

```sh
npm install @rawdash/core
```

## Quick example

```ts
import { GitHubActionsConnector } from '@rawdash/connector-github';
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const github = new GitHubActionsConnector({
  owner: 'my-org',
  repo: 'my-repo',
  token: secret('GITHUB_TOKEN'),
});

export default defineConfig({
  connectors: [{ connector: github }],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        open_prs: {
          kind: 'stat',
          title: 'Open PRs',
          metric: defineMetric({
            connector: github,
            shape: 'entity',
            field: 'id',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'open' }],
          }),
        },
      },
    }),
  },
});
```

## API

### `defineConfig(config)`

Validates and returns a `DashboardConfig`. Throws if a widget references an unknown connector or uses invalid shape/fn values.

### `defineDashboard({ widgets })`

Validates and returns a `Dashboard`. Widget keys must be URL-safe (`[a-zA-Z0-9_-]`).

### `defineMetric(options)`

Returns a `ResolvedMetric` that can be used in stat, timeseries, and distribution widgets.

### `secret(name)`

Returns a `SecretRef` that resolves the named environment variable at runtime. Connectors that accept a `token` or API key should use this to avoid hardcoding credentials.

### `defineConnector(options)`

Low-level factory for authoring new connectors. Used by packages like `@rawdash/connector-github`.

## Links

- [rawdash docs](https://rawdash.dev)
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
