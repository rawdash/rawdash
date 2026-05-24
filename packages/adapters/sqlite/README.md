# @rawdash/adapter-sqlite

[![npm version](https://img.shields.io/npm/v/@rawdash/adapter-sqlite)](https://www.npmjs.com/package/@rawdash/adapter-sqlite)
[![license](https://img.shields.io/npm/l/@rawdash/adapter-sqlite)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

File-backed SQLite `ServerStorage` for rawdash. Designed for local OSS
development: drop a single file in `.rawdash/storage.sqlite`, survive dev
server restarts, never burn through API rate limits cold-starting on every
file change.

Internally a thin wrapper over [`@rawdash/adapter-libsql`](../libsql) pointed
at a local file via libSQL's `file:` URL scheme — same schema, same
migrations, same advisory-lock semantics.

## Install

```sh
npm install @rawdash/adapter-sqlite
```

## Quick example

```ts
import { serve as honoServe } from '@hono/node-server';
import { SqliteStorage } from '@rawdash/adapter-sqlite';
import { mountEngine } from '@rawdash/hono';

import config from './rawdash.config';

const storage = new SqliteStorage('.rawdash/storage.sqlite');

const { app } = mountEngine(config, { storage });
honoServe({ fetch: app.fetch, port: 8080 });
```

The parent directory is created automatically. To opt out, pass
`{ ensureDir: false }`.

## Resetting

Nuke the file (or its containing directory) to start fresh:

```sh
rm -rf .rawdash
```

## License

Apache-2.0
