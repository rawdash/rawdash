# @rawdash/server

## 0.28.1

### Patch Changes

- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Minor Changes

- 204204a: Widgets can now combine data from multiple connectors. A widget's `metric` accepts either a single `ComputedMetric` (unchanged) or an array of metrics — one per connector — each with its own `name`/`field`/`fn`. Resolved widgets expose a per-connector `series[]` on `CachedWidget`, and `StatusWidget.source` accepts a list of connectors for a combined worst-of health badge.

  An optional `aggregate: { fn }` on a widget merges the per-connector series server-side into the top-level `data`. The same merge is available client-side via the new `mergeSeries` / `mergeSeriesScalar` helpers (exported from `@rawdash/core`, `@rawdash/sdk-client`, and `@rawdash/sdk-nextjs`).

  Single-connector widgets are unchanged on the wire. The `metric` and `source` config types widen to unions, which is a type-level breaking change for code that introspects widget configs.

### Patch Changes

- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0

## 0.27.0

### Patch Changes

- @rawdash/core@0.27.0

## 0.26.0

### Patch Changes

- @rawdash/core@0.26.0

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

## 0.24.0

### Patch Changes

- ad70083: Add widget `format` field for display formatting; currency format derives scale from field's declared unit

  Widgets (stat, timeseries, distribution) now accept an optional `format` field:

  ```ts
  format?: {
    kind: 'currency' | 'number' | 'percent' | 'duration' | 'bytes';
    currency?: string;  // e.g. 'USD'
    decimals?: number;
    compact?: boolean;  // render as 1.2M
  }
  ```

  For `kind: 'currency'`, the scale divisor is derived automatically from the metric field's declared `unit` — a field declared `unit: 'cents'` produces `scale: 100` in the API response, so the frontend divides raw cents by 100 to display dollars. No magic numbers needed in widget config.

  The widgets API (`CachedWidget`) now carries a `format` field (type `ResolvedWidgetFormat`) alongside `data`, including the derived `scale` for currency widgets when connector resource definitions are available.

  **Validation updates (RAW-522 follow-up):**
  - The existing cents-without-conversion warning now points to `format: { kind: 'currency' }` as the fix.
  - The warning is suppressed when the widget already sets `format: { kind: 'currency' }`.
  - A new warning fires when `format: { kind: 'currency' }` is set on a field with no declared currency unit.

  **Connector audit:**
  - `@rawdash/connector-google-ads`: resource `unit` updated from `'cost'` to `'USD'` (values were already stored in full currency units after micros conversion).
  - `@rawdash/connector-meta-ads`: resource `unit` updated from `'spend'` to `'USD'`.

  **New exports from `@rawdash/core`:** `WidgetFormat`, `ResolvedWidgetFormat`, `widgetFormatSchema`, `currencyScaleFromUnit`.

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0

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

## 0.22.0

### Patch Changes

- afbf954: Carry widget filters into connector fetch via per-resource FetchSpecs.

  `@rawdash/core` now models backfill output as `ResourceBackfill { specs: FetchSpec[] }` (was `{ requiredWindowMs }`), merging per resource so same-filter specs collapse to the loosest window while different filter sets are kept apart. Adds `fetchSpecsForConnector`, `SyncOptions.fetchSpecs`, `resolveSpecCutoff`, optional `filterable` on resource definitions, and per-spec cursor support in `paginateChunked`. The GitHub connector pushes recognized `state` filters down to the API and applies a per-spec cutoff; the OSS sync runner routes through `fetchSpecsForConnector` so OSS and cloud share one fetch path.

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0

## 0.21.1

### Patch Changes

- @rawdash/core@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Patch Changes

- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0

## 0.17.0

### Patch Changes

- @rawdash/core@0.17.0

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

- 79fdd64: Connectors can now expose `count()` / `latest()` aggregate operations and the runner calls them directly instead of paginating entities for single-scalar stat widgets.

  `Connector` gains an optional `aggregate(req, signal)` method. Core ships `classifyWidget(widget)` to bucket each widget into `{ via: 'aggregate' | 'entity-sync' }` — aggregate-eligible widgets are plain `stat` widgets whose `fn` is `count` or `latest` with no `window`, no `groupBy`, and (for `latest`) a `field`. `runSync` now:
  1. Walks every widget targeting the connector, runs `connector.aggregate(...)` in parallel for the aggregate-eligible ones, and stores the scalar under an `__widget_aggregate` entity (`getEntity(AGGREGATE_ENTITY_TYPE, widgetId)`).
  2. Drops a resource from the entity-sync allowlist only when every widget using it is aggregate-served. When the resulting allowlist is empty the entity-sync pass is skipped entirely.
  3. `resolveWidget` reads the cached aggregate scalar first for aggregate-eligible widgets, falling back to `computeMetric` when no scalar has been written yet.

  The GitHub connector implements `aggregate` against efficient REST endpoints: `/repos/X` for `repo` stars/forks/watchers, `/search/issues` (`total_count`) for `pull_request` / `issue` counts, `/repos/X/contributors?per_page=1` for the contributor count (parsed from the `Link` header), and `/repos/X/actions/runs?per_page=1` for the latest `workflow_run`. For the `example-nextjs` dashboard, a cold-start sync collapses from ~600 paginated requests to ~7 single requests.

  `FilterClause` / `FilterCondition` / `FilterOperator` moved to a dedicated `filters.ts` module and are re-exported from both `config` and the package root — no source change for consumers.

- 79ca05e: Loop chunked connector results in `runSync` instead of erroring out.

  `runSync` previously called `connector.sync({ mode: 'full' })` exactly once and pushed a `"did not complete in one chunk (chunked syncs are only supported in cloud)"` error whenever a connector returned `{ done: false }`. In practice that hard-failed every realistic GitHub repo (and other paginated connectors), so OSS dashboards could not complete a sync.

  The runner now threads the returned `cursor` back into the next `connector.sync({ mode: 'full', cursor })` call and keeps looping until the connector returns `done: true`. The existing per-connector `AbortController` / `FULL_SYNC_TIMEOUT_MS` budget is shared across all chunks so a runaway connector still can't pin sync state in `running`. A new `FULL_SYNC_MAX_CHUNKS = 1000` safety net fails the run if a connector returns `done: false` indefinitely without progressing.

  Cloud's cross-restart cursor persistence keeps working on top of the same connector contract — this only fixes the in-process OSS loop.

- 5026a5b: Make `ServerStorage.markSyncRunning` optional. It's an in-process-only concern: `runSync` calls it to acquire the `queued → running` lock. Deferred-mode storages (where an external runner drives the `running → succeeded/failed` transitions via its own aggregation) may now omit `markSyncRunning` entirely — `runSync` and the MCP `trigger_sync` tool both skip the call when it's absent. In-process storages (`InMemoryStorage`, `LibsqlStorage`) still implement it; no behavior change for in-process users.
- c27c332: Remove the connector-level `aggregate()` query fast-path; connectors are now pure resource syncers and the engine owns all query-time aggregation.

  `Connector` no longer exposes `aggregate()` or `validateCountFilter()`, and the `AggregateRequest` / `AggregateValue` types, `classifyWidget`, `readAggregate`, and `writeAggregate` are removed from `@rawdash/core`. During sync the runner no longer dispatches `connector.aggregate()`, writes `__widget_aggregate` rows, or drops resources from the entity-sync allowlist — every in-scope resource is entity-synced and `resolveWidget` always evaluates the metric via `computeMetric` over synced rows.

  The `github` and `hubspot` connectors drop their `aggregate()` / `validateCountFilter()` implementations. Correctness is unchanged; this only trades extra sync volume for a uniform, decoupled contract. Widget-level aggregation (`defineMetric({ fn: 'count', ... })` → `computeMetric`) and natively metric-shaped sources (CloudWatch, Cost Explorer, Google Analytics) are unaffected.

- e8b014a: Scope OSS sync to widget-referenced resources, not just connectors.

  `computeConnectorBackfill` now returns per-resource scope (`Map<connectorName, Map<resourceName, { requiredWindowMs }>>`) so the runner knows which resources each widget actually references. **Breaking** for direct consumers of `computeConnectorBackfill`: the return shape gained an inner `Map<resourceName, ResourceBackfill>` layer where it previously held a single `ConnectorBackfill` per connector. Status widgets register their connector with an empty inner map.

  `SyncOptions` gains an optional `resources?: ReadonlySet<string>` allowlist. `runSync` derives it (plus the max window across resources) from the per-resource scope and threads it into every `connector.sync` call. Connectors that don't read the option keep their current behavior.

  The GitHub connector now gates its phases on the allowlist via a `PHASE_RESOURCES` map — dashboards that don't reference `deployment`, `release`, or `contributor` no longer page through `/deployments`, `/deployment_statuses`, `/releases`, or `/stats/contributors`. An empty allowlist (status-only configs) short-circuits to `done: true` so the sync run still completes for connector-health tracking without hitting upstream.

- d52a6a8: Scope OSS sync to widget-driven backfill windows.

  `runSync` previously called every configured connector with `mode: 'full'` and no `since`, so connectors paginated all of upstream history on every sync — blowing past the 1000-chunk safety cap on real-world repos and making the example dashboards un-syncable.

  `computeConnectorBackfill` (new in `@rawdash/core`) walks `config.dashboards.*.widgets`, groups them by connector name, and computes the max window per connector. Status widgets count as references; current-state widgets with no window keep the connector in the map but leave the window undefined.

  `runSync` now skips connectors with zero referencing widgets, and passes `since = now − requiredWindow − 1d buffer` whenever a window is present.

  The GitHub connector honors `since` on `pull_requests` (sorted by `updated` desc and stopping at the cutoff), `deployments`, and `releases`. Sentry, Linear, Stripe, Vercel, and Google Analytics also honor `since` under `mode: 'full'` so the widget-driven window flows end-to-end. Stripe subscriptions are intentionally exempt from the `created[gte]` cutoff in full mode because subscription `updated_at` is derived from `current_period_end` and a still-active subscription created before the cutoff would otherwise be dropped.

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

- 686da2b: Populate `CachedWidget.syncState` and `CachedWidget.meta` from per-connector health.

  `WidgetSyncState` is now `'fresh' | 'stale' | 'unsynced' | 'syncing' | 'failing'` — the previous `'synced'` / `'error'` variants are gone (they were declared in the wire types but never populated, so no consumer should depend on them).

  `StorageHandle` gains an optional `getHealth?(): Promise<ConnectorHealth | null>` accessor, and `ConnectorHealth` is exported from `@rawdash/core` and re-exported from `@rawdash/server`. `resolveWidget` calls it to derive `syncState` and `meta.connectorStatus` per widget, falling back to `fresh|unsynced` from the resolved data when health is absent. `CachedWidget.cachedAt` is now sourced from the connector's `lastSyncAt` instead of the global `SyncState.lastSyncAt`.

  `InMemoryStorage` implements `getHealth()` with a minimal shape — `lastSyncAt` is the last write timestamp per connector, `syncIntervalSeconds: 0`. Cloud / libSQL adapters that track per-connector status can implement `getHealth()` to surface rich `failing` / `syncing` states; adapters that don't implement it still get a `syncState` fallback (`'fresh'` when data exists, `'unsynced'` otherwise) but no `meta`.

### Patch Changes

- 09f4ed8: Add deferred-runner mode to `triggerSync` (`@rawdash/server`) and `createSyncRouter` (`@rawdash/hono`). Pass `mode: 'deferred'` to skip `runSync` and the `getConfig` call — the handler only persists the `queued` transition, leaving `running → succeeded/failed` to an external runner (e.g. a queue consumer worker). Default `mode: 'in-process'` keeps existing behavior unchanged.
- 479ca27: Add an optional `WidgetCache` hook to `listWidgets` / `getWidget` (`@rawdash/server`) and `createWidgetsRouter` (`@rawdash/hono`). Deployments can plug in any cache (in-memory LRU, KV, Redis, …) without forking the resolver; the impl owns TTL, eviction, and the backing store. When omitted, behavior is unchanged. `createWidgetsRouter` accepts a `cache: (c: Context) => WidgetCache` factory invoked once per request, so the cache can be scoped to the request's tenant/auth context. Cache errors are isolated — `get` failures fall through to fresh resolution, `set` failures are logged via `console.warn`.
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

- 8e217a5: Cancellable per-run storage handles. `ServerStorage.getStorageHandle()` now accepts an optional `{ signal: AbortSignal }`; when the signal aborts, every subsequent write on the returned `StorageHandle` becomes a no-op with a single `console.warn`. The HTTP `/sync` route wires the per-connector timeout controller through, so a connector that times out can no longer leak tail writes into the next sync run even if it ignores its own `AbortSignal`. Reads on the handle are unaffected. `InMemoryStorage` and `LibsqlStorage` apply the wrapping automatically; external `ServerStorage` implementations get the same behavior for free if they forward the option (or by composing with the exported `withAbortSignal(handle, signal)` helper).
- Updated dependencies [8e217a5]
- Updated dependencies [6912896]
  - @rawdash/core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [27254b6]
  - @rawdash/core@0.13.0

## 0.12.0

### Patch Changes

- @rawdash/core@0.12.0

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

- d4a0db3: `GET /dashboards/:id/widgets` now returns a `{ widgets: CachedWidgetData[] }` envelope instead of a bare top-level array. This leaves room to add sibling metadata (pagination cursors, sync state, error envelopes, etc.) without another breaking change.

  The `@rawdash/client` SDK (`http().getWidgets()`) unwraps `.widgets` internally, so consumers using the SDK still receive `CachedWidgetData[]` and need no changes. Anyone calling the HTTP endpoint directly (without the SDK) needs to read from the `widgets` field.

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

### Patch Changes

- Updated dependencies [533e632]
  - @rawdash/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [28355ff]
  - @rawdash/core@0.8.0

## 0.7.1

### Patch Changes

- @rawdash/core@0.7.1

## 0.7.0

### Patch Changes

- @rawdash/core@0.7.0

## 0.6.1

### Patch Changes

- @rawdash/core@0.6.1

## 0.6.0

### Patch Changes

- @rawdash/core@0.6.0

## 0.5.0

### Patch Changes

- e42e3f8: Republish packages with `workspace:*` deps rewritten to real semver ranges. The publish workflow regressed in #59 and was emitting `"workspace:*"` literally into published `package.json` files, breaking installs for external consumers. The script now uses `pnpm publish` (which packs through pnpm's workspace-aware path) instead of `npm publish` directly.
- Updated dependencies [fe3e046]
- Updated dependencies [e42e3f8]
  - @rawdash/core@0.5.0

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

## 0.3.0

### Patch Changes

- Updated dependencies [c70db8d]
- Updated dependencies [13744df]
- Updated dependencies [2ca8591]
  - @rawdash/core@0.3.0

## 0.2.0

### Patch Changes

- 725ea8a: Extract the widget engine into a runtime-neutral module in `@rawdash/core`.
  - `computeMetric`, `resolveWidget`, `InMemoryStorage`, and the `ServerStorage` interface now live in `@rawdash/core` and are re-exported from `@rawdash/server` for back-compat.
  - New `@rawdash/core/libsql` subpath export ships a `LibsqlStorage` adapter built on `@libsql/client/web` — runtime-neutral and Worker-compatible (no Node APIs, no drizzle migrator).
  - `widgetSchemas` (and new `widgetSchema`, `resolvedMetricSchema`, `filterClauseSchema`, `groupBySchema`, etc.) now describe the actual rich `Widget` discriminated union instead of using a placeholder `metric: z.string()`.

- Updated dependencies [725ea8a]
  - @rawdash/core@0.2.0

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

### Patch Changes

- Updated dependencies [0f069f7]
  - @rawdash/core@0.1.0
