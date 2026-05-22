# @rawdash/connector-stripe

## 0.14.0

### Minor Changes

- 6912896: **Breaking.** Redesigned the sync/health wire contract and split `@rawdash/server` into a framework-agnostic core (pure handlers, engine, types) and a new `@rawdash/hono` adapter package.

  ### Wire contract (breaking)
  - `GET /health` now returns `{status: 'ok'}` — liveness only, no storage access.
  - New `GET /sync/state` returns the sync projection (the data `/health` used to return).
  - `POST /sync` returns `{queued: true|false}` immediately; it never blocks waiting for the sync to finish.
  - `SyncState.status` is now `'idle' | 'queued' | 'running' | 'succeeded' | 'failed'`, with new `queuedAt` and `startedAt` fields. (Was: `'idle' | 'syncing' | 'error'`.)

  Migrate clients to poll `/sync/state` instead of `/health`. `@rawdash/client.ensureFresh` does this automatically.

  ### Package changes (breaking)
  - `@rawdash/server` no longer depends on Hono. It exports pure handler functions (`listWidgets`, `getWidget`, `triggerSync`, `getSyncStateHandler`, `getHealth`, `runRetentionOnce`), an `EngineContext` interface, `ROUTES` constants, the `RawdashError` class, and the engine (`createEngine`, `runSync`, `runRetention`). `serve()` is gone.
  - **New `@rawdash/hono` package** — Hono router factories (`createWidgetsRouter`, `createSyncRouter`, `createSyncStateRouter`, `createHealthRouter`, `createRetentionRouter`) and a `mountEngine` convenience. This is the only package with a `hono` dependency now, and it ships no Node-specific code.
  - `ServerStorage` methods renamed: `setSyncing` → `markSyncRunning`, `setSyncSuccess` → `markSyncSucceeded`, `setSyncError` → `markSyncFailed`. New `markSyncQueued()` method.
  - `@rawdash/client` data sources gained `getSyncState()`. `getHealth()` now returns `{status:'ok'}` only. `ensureFresh` polls `/sync/state` and throws fast on unrecognized status values (no more 30s deadlocks on contract mismatches).

  ### Migration

  Replace `import { serve } from '@rawdash/server'` with:

  ```ts
  import { serve as honoServe } from '@hono/node-server';
  import { mountEngine } from '@rawdash/hono';

  const { app } = mountEngine(config, { storage });
  honoServe({ fetch: app.fetch, port: 8080 });
  ```

  Replace storage method calls:

  ```ts
  // before
  await storage.setSyncing();
  await storage.setSyncSuccess();
  await storage.setSyncError('boom');

  // after
  await storage.markSyncRunning();
  await storage.markSyncSucceeded();
  await storage.markSyncFailed('boom');
  ```

  If you were calling `GET /health` to read sync state, switch to `GET /sync/state`. `@rawdash/client` users get this for free.

  ### Other
  - `@rawdash/adapter-libsql` adds migration `0002_milky_echo` (two `ALTER TABLE ... ADD COLUMN` statements for `queued_at` and `started_at`). Applies automatically on first run; safe on populated databases.
  - The libsql migrations bundle script now runs Prettier internally so the output is byte-stable across runs. A new CI step (`pnpm --filter @rawdash/adapter-libsql db:bundle && git diff --exit-code`) catches stale bundles.
  - `@rawdash/mcp`'s `trigger_sync` tool uses the new storage methods.
  - `@rawdash/nextjs.createRawdashClient` polls `/sync/state` (via the underlying data source) instead of `/health`.

### Patch Changes

- b893152: Add fast-check property tests for connector `sync()` invariants. Each connector now has a `property.test.ts` that generates synthetic API payloads from Zod schemas and asserts universal invariants (non-empty entity ids, finite event timestamps, no `undefined` reaching storage, no throws on any valid input) against `InMemoryStorage`. The reusable helper lives in the new internal `@rawdash/connector-test-utils` package.
- Updated dependencies [8e217a5]
- Updated dependencies [6912896]
  - @rawdash/core@0.14.0

## 0.13.0

### Patch Changes

- 04d849e: Add `default` export pointing at the connector class on every `@rawdash/connector-*` package. Enables symbol-name-agnostic build-time codegen for rawdash cloud's connector registry. Existing named exports (`GitHubConnector`, `StripeConnector`, `GA4Connector`) are unchanged.
- Updated dependencies [27254b6]
  - @rawdash/core@0.13.0

## 0.12.0

### Minor Changes

- 7139c61: Unify the `static create(input, ctx?)` signature across all connectors so the hosted cloud sync-consumer can register them through a single collapsed registry instead of per-connector adapters.
  - `GitHubActionsConnector.create`, `StripeConnector.create`, `GA4Connector.create` now all take an optional `ConnectorContext` as the second argument and forward it to the constructor. This is the hook the cloud uses to attach a per-sync request observer (RAW-279) without a per-connector adapter knowing how to split raw config into `(settings, creds)`.
  - `StripeConnector.create` and `GA4Connector.create` now return the connector instance directly instead of `{ connector }`. `GitHubActionsConnector.create` already did this; the three are now consistent.
  - `ConnectorFactory.create` in `@rawdash/mcp` is correspondingly typed `(settings: unknown) => Connector` (was `=> ConfiguredConnector`); the `add_connector` tool wraps the bare connector into the `{ connector }` shape that `DashboardConfig.connectors` still uses.

  Breaking:
  - Callers of `StripeConnector.create({...}).connector` or `GA4Connector.create({...}).connector` should drop the `.connector` destructure — `create()` now returns the connector itself.
  - `ConnectorFactory.create` implementations that returned `{ connector }` should return the bare `Connector` instance instead.

### Patch Changes

- @rawdash/core@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [7adee87]
- Updated dependencies [8ee5006]
  - @rawdash/core@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [019b54a]
  - @rawdash/core@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [eae669e]
  - @rawdash/core@0.10.0

## 0.9.0

### Minor Changes

- 52e813f: Add `@rawdash/connector-stripe` — a Stripe billing connector that syncs customers, products, prices, subscriptions, invoices, charges, payment intents, disputes, and refunds into the six-shape storage model. Authentication is via a Stripe Restricted API key; users can scope the connector by passing a `resources` array to sync only a subset. Subscriptions ship with a precomputed `mrrAmount` attribute (monthly-equivalent revenue across all subscription items). Full and incremental sync modes both use Stripe's `starting_after` cursor pagination and are resumable via `paginateChunked`. Stripe Connect platforms can target a connected account by setting `accountId`.

### Patch Changes

- Updated dependencies [533e632]
  - @rawdash/core@0.9.0
