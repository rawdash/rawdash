# @rawdash/mcp

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0

## 0.17.0

### Patch Changes

- @rawdash/core@0.17.0

## 0.16.0

### Patch Changes

- 5026a5b: Make `ServerStorage.markSyncRunning` optional. It's an in-process-only concern: `runSync` calls it to acquire the `queued → running` lock. Deferred-mode storages (where an external runner drives the `running → succeeded/failed` transitions via its own aggregation) may now omit `markSyncRunning` entirely — `runSync` and the MCP `trigger_sync` tool both skip the call when it's absent. In-process storages (`InMemoryStorage`, `LibsqlStorage`) still implement it; no behavior change for in-process users.
- Updated dependencies [422b711]
- Updated dependencies [79fdd64]
- Updated dependencies [a1c4c66]
- Updated dependencies [074ec25]
- Updated dependencies [022cbf1]
- Updated dependencies [e104540]
- Updated dependencies [9169ceb]
- Updated dependencies [5026a5b]
- Updated dependencies [c27c332]
- Updated dependencies [e8b014a]
- Updated dependencies [7060534]
- Updated dependencies [d52a6a8]
- Updated dependencies [d17a523]
  - @rawdash/core@0.16.0

## 0.15.0

### Minor Changes

- 05ecf90: **Breaking:** Split declarative `DashboardConfig` from runtime `Connector` instances.

  `DashboardConfig.connectors` is now an array of declarative entries (`{ name, connectorId, config, syncIntervalSeconds?, enabled?, displayName? }`) instead of `{ connector: Connector }` wrappers around live instances. Connector implementations are wired separately via a `connectorRegistry` option on `mountEngine`, `createSyncRouter`, `createEngine`, and `triggerSync` (in-process mode). `secretsResolver` is exposed as the same per-deployment channel.

  Migration:

  ```ts
  // before
  const github = new GitHubConnector(
    { owner: 'acme', repo: 'web' },
    { token: secret('GH_TOKEN') },
  );
  mountEngine(
    defineConfig({
      connectors: [{ connector: github }],
      dashboards: { /* ... */ },
    }),
    { storage },
  );

  // after
  const github = {
    name: 'main',
    connectorId: 'github-actions',
    config: { owner: 'acme', repo: 'web', token: secret('GH_TOKEN') },
  };
  mountEngine(
    defineConfig({
      connectors: [github],
      dashboards: { /* ... */ },
    }),
    {
      connectorRegistry: { 'github-actions': GitHubConnector },
      storage,
    },
  );
  ```

  Same config object now works in-process, in deferred-runner mode, and in cloud. `resolveWidget` accepts `readonly string[] | undefined` (connector instance names) instead of the previous `ConfiguredConnector[] | string[]` union. `toWireConfig` is now a near-identity passthrough; the wire format is the in-memory shape.

### Patch Changes

- Updated dependencies [1ad2bc0]
- Updated dependencies [05ecf90]
- Updated dependencies [686da2b]
  - @rawdash/core@0.15.0

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

- Updated dependencies [8e217a5]
- Updated dependencies [6912896]
  - @rawdash/core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [27254b6]
  - @rawdash/core@0.13.0
  - @rawdash/server@0.13.0

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
- @rawdash/server@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [7adee87]
- Updated dependencies [8ee5006]
- Updated dependencies [d4a0db3]
  - @rawdash/core@0.11.0
  - @rawdash/server@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [019b54a]
  - @rawdash/core@0.10.1
  - @rawdash/server@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [eae669e]
  - @rawdash/core@0.10.0
  - @rawdash/server@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [533e632]
  - @rawdash/core@0.9.0
  - @rawdash/server@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [28355ff]
  - @rawdash/core@0.8.0
  - @rawdash/server@0.8.0

## 0.7.1

### Patch Changes

- @rawdash/core@0.7.1
- @rawdash/server@0.7.1

## 0.7.0

### Patch Changes

- @rawdash/core@0.7.0
- @rawdash/server@0.7.0

## 0.6.1

### Patch Changes

- @rawdash/core@0.6.1
- @rawdash/server@0.6.1

## 0.6.0

### Patch Changes

- @rawdash/core@0.6.0
- @rawdash/server@0.6.0

## 0.5.0

### Patch Changes

- e42e3f8: Republish packages with `workspace:*` deps rewritten to real semver ranges. The publish workflow regressed in #59 and was emitting `"workspace:*"` literally into published `package.json` files, breaking installs for external consumers. The script now uses `pnpm publish` (which packs through pnpm's workspace-aware path) instead of `npm publish` directly.
- Updated dependencies [fe3e046]
- Updated dependencies [e42e3f8]
  - @rawdash/core@0.5.0
  - @rawdash/server@0.5.0

## 0.4.0

### Minor Changes

- 6fb7a7d: Consolidate libSQL storage into `@rawdash/adapter-libsql`.
  - New package `@rawdash/adapter-libsql` exporting `LibsqlStorage`, a `ServerStorage` backed by libSQL/Turso via Kysely. Works on Node and Cloudflare Workers from the same package.
  - Built-in schema migrations: Drizzle schema is the source of truth for `drizzle-kit generate`; runtime applies inlined SQL via a tiny applier (no `fs` / `fileURLToPath`, so Workers-safe).
  - Removed `@rawdash/core/libsql` subpath export — use `@rawdash/adapter-libsql` instead.
  - Removed `@rawdash/adapter-turso` — replaced by `@rawdash/adapter-libsql`.

- 9de7a5d: Rename public API types/interfaces/classes for clearer framework ergonomics. Drops noisy suffixes like `Ref`, `Entry`, `Def`, `Response`, and disambiguates several `Metric`-related types.

  Breaking renames:
  - `SecretRef` → `Secret` (and `isSecretRef` → `isSecret`, `resolveSecretRefs` → `resolveSecrets`)
  - `Metric` (data sample) → `MetricSample`
  - `MetricDef` → `Metric`
  - `ResolvedMetric` → `ComputedMetric` (and `resolvedMetricSchema` → `computedMetricSchema`)
  - `ConnectorEntry` → `ConfiguredConnector`
  - `WidgetEntry` → `CachedWidget`
  - `SyncRequest` → `SyncOptions`
  - `RawdashRouter` → `RouterMount`
  - `RawdashEngine` (client) → `ServerDataSource`
  - `RawdashClient` (nextjs) — removed; use `DataSource` directly
  - `RetryOptions` → `RetryPolicy`
  - `CredentialEntry` → `CredentialField`
  - `CredentialSchema` → `CredentialsSchema`
  - `RetentionCandidates` → `RetentionDeletionPlan`
  - `McpError` → `McpErrorPayload`
  - `RuntimeConfig` (mcp) → `McpRuntime`
  - `DiffSet<T>` → `Diff<T>`
  - `CloudConnectorEntry` → `CloudConnectorRecord`
  - `CloudDashboardEntry` → `CloudDashboardRecord`
  - `SecretEntry` → `CloudSecret`
  - `CloudConfigBody` → `CloudConfig`
  - `CachedWidgetResponse` → `CachedWidgetData`
  - `HealthResponse` → `HealthStatus`
  - `SyncTriggerResponse` → `SyncResult`

### Patch Changes

- Updated dependencies [6fb7a7d]
- Updated dependencies [9de7a5d]
  - @rawdash/core@0.4.0
  - @rawdash/server@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [c70db8d]
- Updated dependencies [13744df]
- Updated dependencies [2ca8591]
  - @rawdash/core@0.3.0
  - @rawdash/server@0.3.0

## 0.2.0

### Patch Changes

- 725ea8a: Extract the widget engine into a runtime-neutral module in `@rawdash/core`.
  - `computeMetric`, `resolveWidget`, `InMemoryStorage`, and the `ServerStorage` interface now live in `@rawdash/core` and are re-exported from `@rawdash/server` for back-compat.
  - New `@rawdash/core/libsql` subpath export ships a `LibsqlStorage` adapter built on `@libsql/client/web` — runtime-neutral and Worker-compatible (no Node APIs, no drizzle migrator).
  - `widgetSchemas` (and new `widgetSchema`, `resolvedMetricSchema`, `filterClauseSchema`, `groupBySchema`, etc.) now describe the actual rich `Widget` discriminated union instead of using a placeholder `metric: z.string()`.

- Updated dependencies [725ea8a]
  - @rawdash/core@0.2.0
  - @rawdash/server@0.2.0

## 0.1.0

### Patch Changes

- Updated dependencies [0f069f7]
  - @rawdash/core@0.1.0
  - @rawdash/server@0.1.0
