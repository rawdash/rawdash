# @rawdash/hono

## 0.25.0

### Minor Changes

- f99cb16: Expose a per-widget `status` in the widgets API, and make connector health a required storage capability

  `CachedWidget` now carries a `status` field (plus optional `errorMessage`), computed at read time and stored in whatever cache implementation is injected (in-memory, KV, etc.):
  - `ok` — the metric resolved against matching underlying rows (including a legitimate aggregated `0`, where rows existed but summed/counted to zero).
  - `no_data` — the query matched **zero** underlying rows for the referenced resource. Distinct from a genuine aggregated `0`, so silent-empty widgets stop rendering as healthy zeros. Only reported once the connector has synced at least once (`syncState` `fresh`/`stale`).
  - `error` — **any** widget sync error: the connector reports a failure (health `status` `error`/`auth_failed`, or any non-null `lastError`), or the metric compute threw. A connector error takes precedence over a compute error; the underlying message is surfaced in `errorMessage`.

  **Breaking — connector health moved to the `ServerStorage` interface.** Health is a read/serving concern derived from sync state, not a per-connector write concern, so:
  - `ServerStorage` now requires `getHealth(connectorId): Promise<ConnectorHealth | null>`.
  - The optional `StorageHandle.getHealth?()` has been **removed** (it was the wrong layer and silently absent in most storages — a failed sync never surfaced as a widget error).

  Any custom `ServerStorage` implementation (e.g. a cloud-injected storage) must add `getHealth`. The first-party storages already do: `InMemoryStorage` and the libsql/sqlite adapters derive it from their sync state, reporting a failed sync as a connector `error` with its `lastError`.

  New in `@rawdash/core`: `computeMetricWithStatus` (returns `{ value, matchedRows }`) alongside `computeMetric`; the `WidgetStatus` type; and `healthStatusFromSyncStatus`. The `@rawdash/hono` widgets router carries the new fields through the response payload unchanged.

### Patch Changes

- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0
  - @rawdash/server@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0
  - @rawdash/server@0.24.0

## 0.23.0

### Minor Changes

- 1159dc1: Validate widget metric definitions against connector resource schemas.

  `@rawdash/core` now exports `validateConfigMetrics(config, resourcesByConnectorId)` (plus `resourcesByConnectorIdFromRegistry` to derive that map from a `ConnectorRegistry`). It checks every widget metric against the referenced connector's declared resources and reports:
  - **Errors** for a metric that references an unknown resource name, a shape that doesn't match the resource, or a field (including filter/groupBy fields) the resource doesn't declare — each message lists the valid options.
  - **Warnings** for aggregating a field declared in a minor currency unit (e.g. Stripe `amount` in cents) without conversion, and for a metric whose title/name implies a time window but has no effective `window`.

  Validation runs server-side, where the connector registry (and therefore every connector's schema) already lives: the engine exposes a `POST /config/validate` route (`@rawdash/hono` `createConfigValidateRouter`, mounted by `mountEngine`). `rawdash deploy` calls this route and fails on errors / surfaces warnings before applying, and degrades gracefully if the server doesn't expose it. The CLI no longer bundles the connector packages.

  `ResourceField` gains an optional `unit`, and the Stripe connector declares its monetary fields (`amount`, `mrrAmount`, `amountDue`, `amountPaid`) in `cents` so the cents-without-conversion warning is driven by the connector's own schema.

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0
  - @rawdash/server@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0
  - @rawdash/server@0.22.0

## 0.21.1

### Patch Changes

- @rawdash/core@0.21.1
- @rawdash/server@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0
  - @rawdash/server@0.21.0

## 0.20.0

### Patch Changes

- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0
  - @rawdash/server@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0
  - @rawdash/server@0.19.0

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0
- @rawdash/server@0.18.0

## 0.17.0

### Patch Changes

- @rawdash/core@0.17.0
- @rawdash/server@0.17.0

## 0.16.0

### Minor Changes

- 022cbf1: Connectors now emit structured INFO progress logs during sync.

  Adds a `ConnectorLogger` interface (`info` / `warn`) exposed on `ConnectorContext` and accessible via `this.logger` on `BaseConnector`. The default implementation writes single-line, key=value formatted records to stdout/stderr with a stable `[<scope>]` prefix.

  `paginateChunked` now emits one INFO line per page fetch (`fetched page resource=… page=… items=… cursor=…`), one per resource completion (`resource done resource=… pages=… items=… duration_ms=…`), and a WARN line when a page fetch or batch write fails. `runSync` wraps each connector run in `[runner] sync started` / `[runner] sync settled status=… duration_ms=…` envelopes.

  All five OSS connectors (github, sentry, linear, stripe, vercel) pass `this.logger` into `paginateChunked`, so a multi-minute sync now produces a continuous, parseable stream of progress lines instead of silence between queued and succeeded.

  Operators can BYO logger by passing `loggerFactory: (scope) => ConnectorLogger` to `mountEngine`, `createSyncRouter`, `createEngine`, `triggerSync`, or `runSync` directly. The factory is invoked with `'runner'` for the runner envelopes and with each connector instance name for that connector's logger; omit it to keep the default stdout impl.

- d17a523: **New:** ETag / `If-None-Match` on the per-widget endpoint (`GET /dashboards/:id/widgets/:widgetId`). Turns no-op polls from the subscription engine (RAW-323) into cheap `304 Not Modified` responses, skipping `resolveWithCache` (and the underlying `resolveWidget` + connector storage hits) entirely on match.

  The ETag is `"<lastSyncAt>-<configHash>"`. Including `configHash` ensures a widget-config edit invalidates the cached ETag even when `lastSyncAt` hasn't advanced.
  - `@rawdash/core` — new exports: `computeWidgetEtag`, `hashWidgetConfig`.
  - `@rawdash/server` — `getWidget` signature changed: now accepts `{ cache?, ifNoneMatch? }` options and returns `{ status: 'ok', etag, widget } | { status: 'not-modified', etag }`. Breaking change for callers that consume `getWidget` directly; `@rawdash/hono` is updated.
  - `@rawdash/hono` — widget router emits `ETag` on 200 and `304` when `If-None-Match` matches.
  - `@rawdash/sdk-client` — `http()` transparently caches the last-seen ETag per `(dashboardId, widgetId)`, sends `If-None-Match` on subsequent fetches, and returns the cached body on 304.

  The bundle endpoint (`GET /dashboards/:id/widgets`) is intentionally out of scope. No changes in `@rawdash/sdk-runtime`.

### Patch Changes

- 5026a5b: Make `ServerStorage.markSyncRunning` optional. It's an in-process-only concern: `runSync` calls it to acquire the `queued → running` lock. Deferred-mode storages (where an external runner drives the `running → succeeded/failed` transitions via its own aggregation) may now omit `markSyncRunning` entirely — `runSync` and the MCP `trigger_sync` tool both skip the call when it's absent. In-process storages (`InMemoryStorage`, `LibsqlStorage`) still implement it; no behavior change for in-process users.
- Updated dependencies [422b711]
- Updated dependencies [79fdd64]
- Updated dependencies [a1c4c66]
- Updated dependencies [074ec25]
- Updated dependencies [022cbf1]
- Updated dependencies [e104540]
- Updated dependencies [9169ceb]
- Updated dependencies [79ca05e]
- Updated dependencies [5026a5b]
- Updated dependencies [c27c332]
- Updated dependencies [e8b014a]
- Updated dependencies [7060534]
- Updated dependencies [d52a6a8]
- Updated dependencies [d17a523]
  - @rawdash/core@0.16.0
  - @rawdash/server@0.16.0

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

- 09f4ed8: Add deferred-runner mode to `triggerSync` (`@rawdash/server`) and `createSyncRouter` (`@rawdash/hono`). Pass `mode: 'deferred'` to skip `runSync` and the `getConfig` call — the handler only persists the `queued` transition, leaving `running → succeeded/failed` to an external runner (e.g. a queue consumer worker). Default `mode: 'in-process'` keeps existing behavior unchanged.
- 479ca27: Add an optional `WidgetCache` hook to `listWidgets` / `getWidget` (`@rawdash/server`) and `createWidgetsRouter` (`@rawdash/hono`). Deployments can plug in any cache (in-memory LRU, KV, Redis, …) without forking the resolver; the impl owns TTL, eviction, and the backing store. When omitted, behavior is unchanged. `createWidgetsRouter` accepts a `cache: (c: Context) => WidgetCache` factory invoked once per request, so the cache can be scoped to the request's tenant/auth context. Cache errors are isolated — `get` failures fall through to fresh resolution, `set` failures are logged via `console.warn`.
- Updated dependencies [09f4ed8]
- Updated dependencies [1ad2bc0]
- Updated dependencies [05ecf90]
- Updated dependencies [479ca27]
- Updated dependencies [686da2b]
  - @rawdash/server@0.15.0
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
  - @rawdash/server@0.14.0
