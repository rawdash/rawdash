# @rawdash/core

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

- 8e217a5: Cancellable per-run storage handles. `ServerStorage.getStorageHandle()` now accepts an optional `{ signal: AbortSignal }`; when the signal aborts, every subsequent write on the returned `StorageHandle` becomes a no-op with a single `console.warn`. The HTTP `/sync` route wires the per-connector timeout controller through, so a connector that times out can no longer leak tail writes into the next sync run even if it ignores its own `AbortSignal`. Reads on the handle are unaffected. `InMemoryStorage` and `LibsqlStorage` apply the wrapping automatically; external `ServerStorage` implementations get the same behavior for free if they forward the option (or by composing with the exported `withAbortSignal(handle, signal)` helper).

## 0.13.0

### Patch Changes

- 27254b6: Add optional `secretsResolver` to `ConnectorContext`. When provided, `BaseConnector` resolves credential `Secret` references through it instead of falling back to `EnvSecretsResolver`. Enables hosts (e.g. rawdash cloud) to inject their own secret backend without subclassing connectors.

## 0.12.0

## 0.11.0

### Minor Changes

- 7adee87: Consolidate HTTP wire-format types in `@rawdash/core` so the server and any other backend implementation (including the hosted cloud) can typecheck against the same response contract the SDK consumes. Two production bugs in the last week traced back to silent OSS↔cloud drift; one canonical home eliminates the class.

  New module `@rawdash/core/wire` exports:
  - `CachedWidget<TData = unknown>` — was `CachedWidgetData` in `@rawdash/client`; consolidated with the old `CachedWidget` from `@rawdash/core/engine`. Now generic, `data: TData | null`, optional `syncState`/`meta`. The dead duplicate `id` field is removed (it was always set to the same value as `widgetId`).
  - `WidgetsListResponse` — `{ widgets: CachedWidget[] }` envelope returned by `GET /dashboards/:id/widgets`.
  - `TriggerSyncResponse` — `{ triggered: boolean }`, renamed from the old `SyncResult` in `@rawdash/client` to resolve the name collision with `SyncResult` from `@rawdash/core/connector` (which is a connector-iteration result, not an HTTP response).
  - `WidgetSyncState` — moved from `@rawdash/client`.
  - `DataSource`, `ServerDataSource` — moved from `@rawdash/client`.

  Breaking:
  - `@rawdash/client` no longer exports `CachedWidgetData`, `HealthStatus`, `SyncResult` (for the HTTP-trigger response), `WidgetSyncState`, `DataSource`, `ServerDataSource`. Import from `@rawdash/core` instead. `HealthStatus` has been removed entirely — it was identical to `SyncState`, which already lived in `@rawdash/core`.
  - `@rawdash/nextjs` no longer re-exports those types; import from `@rawdash/core`.
  - `@rawdash/server` no longer re-exports `SyncState`/`CachedWidget`; import from `@rawdash/core`.
  - `CachedWidget.id` removed.
  - `resolveWidget`'s first parameter is now named `widgetId` (was `id`) — call sites unchanged behaviorally.

  Consumers of the SDK that only use the `http()` / `createRawdashClient()` factories see no runtime change; only import paths for type-only references need updating.

- 8ee5006: Require `resource` on `request()` in `@rawdash/connector-shared`, and propagate it through `BaseConnector` in `@rawdash/core`.

  `RequestOptions.resource` is now a required `string` (previously `string | undefined`). The shape-drift pipeline groups observations by `(connector, resource)` end-to-end — leaving it optional meant unguarded call sites silently produced observations the cron could not attribute. TypeScript now blocks any call site that omits it.

  `BaseConnector` now exposes protected `request` / `get` / `post` helpers that take a required `resource` and forward an observer from a new optional `ConnectorContext` (third constructor argument). Connector authors only add `{ resource: '...' }` to each HTTP call site — no observer plumbing.

  `paginateLink` / `paginateCursor` / `paginatePage` now take a trailing `{ resource }` argument and forward it to the underlying `request()` call, so paginated paths are attributed consistently.

  All three OSS connectors (`github-actions`, `stripe`, `google-analytics`) updated to route every HTTP call through the base helpers with a resource name matching their schema keys.

## 0.10.1

### Patch Changes

- 019b54a: `paginateChunked` now also checkpoints on caught `writeBatch` errors. Previously only `fetchPage` was wrapped, so write-side failures (e.g. libsql WebSocket calls tripping the Cloudflare subrequest cap) propagated out uncaught and the host could not advance the cursor. `writeBatch` is now wrapped symmetrically: on a non-abort error the helper returns `{ done: false, cursor: { phase, page }, transientError }` with the same page that failed to write, so the next chunk re-fetches and re-writes that page (writes are idempotent at the storage layer).

## 0.10.0

### Minor Changes

- eae669e: `paginateChunked` now checkpoints on caught fetch errors. When `fetchPage` throws, the helper returns `{ done: false, cursor, transientError }` so the host can re-enqueue from the advanced cursor instead of restarting at the inbound cursor. `SyncResult` gains an optional `transientError?: unknown` field that surfaces the underlying error for host-side retry decisions.

## 0.9.0

### Minor Changes

- 533e632: Add `paginateChunked` helper to `@rawdash/core` for resumable phased pagination, and adopt it in `@rawdash/connector-github`. Connectors that hit the Cloudflare Worker subrequest cap mid-sync can now opt-in by declaring an ordered list of phases plus per-page `fetchPage` / `writeBatch` callbacks; the helper handles cursor advancement, abort handling, and phase rollover, so each sync chunk picks up where the previous one left off.

## 0.8.0

### Minor Changes

- 28355ff: Extend the `Connector.sync` contract with resumable progress: `SyncOptions.cursor?: unknown` carries opaque resumption state from the host, and `sync()` now returns `SyncResult = { done: boolean; cursor?: unknown }` so chunked syncs can hand control back to the host between pages.

  The github-actions connector now threads a `{ phase, pageUrl }` cursor through all paginated phases (workflow runs, pull requests, issues, deployments, releases) and checks `signal.aborted` at page boundaries. When the host signals a yield, the connector returns the in-progress phase + page URL instead of restarting from scratch on the next chunk — letting large GitHub backfills make forward progress under the cloud worker's subrequest budget.

## 0.7.1

## 0.7.0

## 0.6.1

## 0.6.0

## 0.5.0

### Minor Changes

- fe3e046: Expose the wire-body translator from `@rawdash/core`. `toWireConfig`, the `WireConfig` / `WireConnector` / `WireDashboard` types, and matching Zod schemas (`wireConfigSchema`, `wireConnectorSchema`, `wireDashboardSchema`) are now exported from `@rawdash/core` so backend implementations can produce and validate the canonical config wire body without re-implementing it. The CLI now consumes this from core instead of duplicating the translation internally.

### Patch Changes

- e42e3f8: Republish packages with `workspace:*` deps rewritten to real semver ranges. The publish workflow regressed in #59 and was emitting `"workspace:*"` literally into published `package.json` files, breaking installs for external consumers. The script now uses `pnpm publish` (which packs through pnpm's workspace-aware path) instead of `npm publish` directly.

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

## 0.3.0

### Minor Changes

- c70db8d: `resolveWidget` no longer requires an instantiated `ConnectorEntry[]`. The `connectors` parameter now accepts `ConnectorEntry[] | readonly string[] | undefined`:
  - `undefined` skips the membership check entirely — useful in runtimes (e.g. Cloudflare Workers) where connector implementations are not loaded on the read path.
  - `readonly string[]` checks membership against a lightweight allowlist of connector ids.
  - `ConnectorEntry[]` continues to work as before (backward-compatible).

### Patch Changes

- 13744df: Fix `resolvedMetricSchema`: make `field` optional (count-only metrics like `{ fn: 'count' }` have no field) and narrow `fn` from `z.string()` to `aggFnSchema` so consumers get the proper enum type and invalid fns are rejected at validation time.
- 2ca8591: Widen `@libsql/client` peer dependency range to `>=0.14.0 <1.0.0`. The `LibsqlStorage` API surface (`createClient`, `Client`, `execute`, `batch`, `transaction`) has been stable across 0.14 → 0.17, so the previous `^0.14.0` constraint was artificially narrow and produced peer-dep warnings for consumers on newer 0.x releases.

## 0.2.0

### Minor Changes

- 725ea8a: Extract the widget engine into a runtime-neutral module in `@rawdash/core`.
  - `computeMetric`, `resolveWidget`, `InMemoryStorage`, and the `ServerStorage` interface now live in `@rawdash/core` and are re-exported from `@rawdash/server` for back-compat.
  - New `@rawdash/core/libsql` subpath export ships a `LibsqlStorage` adapter built on `@libsql/client/web` — runtime-neutral and Worker-compatible (no Node APIs, no drizzle migrator).
  - `widgetSchemas` (and new `widgetSchema`, `resolvedMetricSchema`, `filterClauseSchema`, `groupBySchema`, etc.) now describe the actual rich `Widget` discriminated union instead of using a placeholder `metric: z.string()`.

## 0.1.0

### Minor Changes

- 0f069f7: **Breaking change**: `defineConfig()` no longer accepts a flat `widgets` map. Widgets are now grouped under named dashboards via `defineDashboard()`.

  **Before:**

  ```ts
  defineConfig({
    connectors: [{ connector: github }],
    widgets: {
      run_count: { metric: defineMetric({ ... }) },
    },
  });
  ```

  **After:**

  ```ts
  defineConfig({
    connectors: [{ connector: github }],
    dashboards: {
      github: defineDashboard({
        widgets: {
          run_count: { metric: defineMetric({ ... }) },
        },
      }),
    },
  });
  ```

  The widgets HTTP API is now dashboard-scoped: `GET /widgets` and `GET /widgets/:id` have been replaced by `GET /dashboards/:dashboardId/widgets` and `GET /dashboards/:dashboardId/widgets/:widgetId`. Widget IDs remain bare keys within their dashboard (e.g. `run_count_7d`); the dashboard is expressed via the URL path.
