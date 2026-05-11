# @rawdash/adapter-turso

[![npm version](https://img.shields.io/npm/v/@rawdash/adapter-turso)](https://www.npmjs.com/package/@rawdash/adapter-turso)
[![license](https://img.shields.io/npm/l/@rawdash/adapter-turso)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Turso / libSQL storage adapter for rawdash.

## What it is

`@rawdash/adapter-turso` is a `ServerStorage` implementation backed by [Turso](https://turso.tech/) (libSQL). It stores connector sync state and all widget data — events, entities, metrics, edges, distributions — in a Turso database, making them persistent across restarts and available across replicated edge deployments.

Use this with `@rawdash/server` or `@rawdash/mcp` anywhere you need durable storage.

## Install

```sh
npm install @rawdash/adapter-turso
```

## Quick example

```ts
import { TursoStorage } from '@rawdash/adapter-turso';
import { GitHubActionsConnector } from '@rawdash/connector-github';
import { secret } from '@rawdash/core';
import { serve } from '@rawdash/server';

const storage = new TursoStorage({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const github = new GitHubActionsConnector({
  owner: 'my-org',
  repo: 'my-repo',
  token: secret('GITHUB_TOKEN'),
});

serve({ connectors: [{ connector: github }], dashboards: {} }, { storage });
```

## Configuration

| Option      | Type     | Required | Description                                                                 |
| ----------- | -------- | -------- | --------------------------------------------------------------------------- |
| `url`       | `string` | Yes      | Turso database URL (e.g. `libsql://your-db.turso.io`)                       |
| `authToken` | `string` | No       | Auth token for remote databases. Omit for local file URLs (`file:./dev.db`) |

## Local development

For local development, use a file-based libSQL database:

```ts
const storage = new TursoStorage({ url: 'file:./rawdash.db' });
```

No auth token needed. The adapter runs migrations automatically on first use.

## Links

- [rawdash docs](https://rawdash.dev)
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
