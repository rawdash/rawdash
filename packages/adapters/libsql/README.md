# @rawdash/adapter-libsql

[![npm version](https://img.shields.io/npm/v/@rawdash/adapter-libsql)](https://www.npmjs.com/package/@rawdash/adapter-libsql)
[![license](https://img.shields.io/npm/l/@rawdash/adapter-libsql)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

libSQL / Turso storage adapter for rawdash.

## What it is

`@rawdash/adapter-libsql` is a `ServerStorage` implementation backed by [libSQL](https://github.com/tursodatabase/libsql) — works against any libSQL endpoint (Turso Cloud, self-hosted libsql-server, or a local file).

Internals: [Kysely](https://kysely.dev) for type-safe queries on top of `@libsql/client`. Runs on Node and Cloudflare Workers / V8 edge from the same package.

## Install

```sh
npm install @rawdash/adapter-libsql @libsql/client
```

## Quick example

```ts
import { serve as honoServe } from '@hono/node-server';
import { createClient } from '@libsql/client';
import { LibsqlStorage } from '@rawdash/adapter-libsql';
import { defineConfig } from '@rawdash/core';
import { mountEngine } from '@rawdash/hono';

const storage = new LibsqlStorage({
  client: createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
});

const config = defineConfig({
  connectors: [],
  dashboards: {},
});

const { app } = mountEngine(config, { storage });
honoServe({ fetch: app.fetch, port: 8080 });
```

On Cloudflare Workers, import from `@libsql/client/web` and pass the resulting client in the same way.

## Migrations

The Drizzle schema in `src/drizzle-schema.ts` is the source of truth.

- `pnpm db:generate` runs `drizzle-kit generate` to emit a new `migrations/NNNN_*.sql` file, then inlines the SQL into `src/migrations-bundle.ts` (formatted to match the repo's Prettier config so the regeneration is byte-stable).
- The bundle is **committed** so the package can ship to npm without a build step. CI runs `pnpm --filter @rawdash/adapter-libsql db:bundle` and fails if the result differs from what's checked in — this catches `.sql` migrations added without regenerating the bundle.
- At runtime, `LibsqlStorage` applies pending migrations from `MIGRATIONS` on first use and records applied versions in a `schema_migrations` table. The runtime applier reads from the inlined array — no filesystem access — so it works on Cloudflare Workers and other edge runtimes.

## License

Apache-2.0
