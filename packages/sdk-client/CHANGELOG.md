# @rawdash/client

## 0.26.0

### Patch Changes

- @rawdash/core@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0

## 0.22.0

### Patch Changes

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

- 9318670: **Breaking:** the two frontend SDK packages have been renamed with an `sdk-` prefix so the namespace stays consistent as more SDK-layer packages land (notably the upcoming `@rawdash/sdk-runtime`).
  - `@rawdash/client` → `@rawdash/sdk-client`
  - `@rawdash/nextjs` → `@rawdash/sdk-nextjs`

  There are no compatibility shims under the old names. The old packages are deprecated on npm — installing them will print a pointer to the new names but will not be republished.

  ## Migration

  ### 1. Swap the dependencies in `package.json`

  ```bash
  npm uninstall @rawdash/client @rawdash/nextjs
  npm install @rawdash/sdk-client @rawdash/sdk-nextjs
  # or: pnpm remove ... && pnpm add ...
  # or: yarn remove ...   && yarn add ...
  ```

  Only install the packages you were already using.

  ### 2. Update imports across your codebase

  Two literal replacements, nothing else changes:
  - `@rawdash/client` → `@rawdash/sdk-client`
  - `@rawdash/nextjs` → `@rawdash/sdk-nextjs`

  A portable one-liner that works on macOS and Linux:

  ```bash
  git grep -lE '@rawdash/(client|nextjs)' \
    | xargs perl -i -pe 's{\@rawdash/client\b}{\@rawdash/sdk-client}g; s{\@rawdash/nextjs\b}{\@rawdash/sdk-nextjs}g'
  ```

  The `\b` word boundary is important — without it, a naive replace would corrupt `@rawdash/connector-*` paths or any future `@rawdash/client-*` / `@rawdash/nextjs-*` package names.

  ### 3. Drop any `@rawdash/core` imports that only existed for types

  `@rawdash/sdk-nextjs` now re-exports the public consumer surface from `@rawdash/core` — `DataSource`, `CachedWidget`, `HealthResponse`, `SyncState`, `SyncStatus`, `TriggerSyncResponse`, `WidgetSyncState`, `WidgetsListResponse`, plus the `isSyncActive` / `ACTIVE_SYNC_STATUSES` helpers. If you only imported `@rawdash/core` to type a `DataSource` helper, you can now pull it from `@rawdash/sdk-nextjs` instead and remove the direct `@rawdash/core` dependency from your app.

  No runtime, wire-format, or API-shape changes. The version of both packages is bumped to a `minor` per the pre-1.0 breaking-change policy.

- d17a523: **New:** ETag / `If-None-Match` on the per-widget endpoint (`GET /dashboards/:id/widgets/:widgetId`). Turns no-op polls from the subscription engine (RAW-323) into cheap `304 Not Modified` responses, skipping `resolveWithCache` (and the underlying `resolveWidget` + connector storage hits) entirely on match.

  The ETag is `"<lastSyncAt>-<configHash>"`. Including `configHash` ensures a widget-config edit invalidates the cached ETag even when `lastSyncAt` hasn't advanced.
  - `@rawdash/core` — new exports: `computeWidgetEtag`, `hashWidgetConfig`.
  - `@rawdash/server` — `getWidget` signature changed: now accepts `{ cache?, ifNoneMatch? }` options and returns `{ status: 'ok', etag, widget } | { status: 'not-modified', etag }`. Breaking change for callers that consume `getWidget` directly; `@rawdash/hono` is updated.
  - `@rawdash/hono` — widget router emits `ETag` on 200 and `304` when `If-None-Match` matches.
  - `@rawdash/sdk-client` — `http()` transparently caches the last-seen ETag per `(dashboardId, widgetId)`, sends `If-None-Match` on subsequent fetches, and returns the cached body on 304.

  The bundle endpoint (`GET /dashboards/:id/widgets`) is intentionally out of scope. No changes in `@rawdash/sdk-runtime`.

### Patch Changes

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

- d4a0db3: Model the unsynced widget state in `CachedWidgetData`:
  - `data` is now `TData | null`. A widget that has never been synced legitimately has no data.
  - New optional `syncState: 'synced' | 'unsynced' | 'syncing' | 'error'` and `meta: Record<string, unknown>` fields capture sync metadata. Self-hosted servers can simply omit them.
  - New `WidgetSyncState` type is exported from `@rawdash/client` and re-exported from `@rawdash/nextjs`.

  Backwards compatible for the common case (existing SDK consumers that always called the server after a sync), but the type widening of `data` may surface unchecked `null` cases in consumer code — TypeScript will flag them.

- d4a0db3: `GET /dashboards/:id/widgets` now returns a `{ widgets: CachedWidgetData[] }` envelope instead of a bare top-level array. This leaves room to add sibling metadata (pagination cursors, sync state, error envelopes, etc.) without another breaking change.

  The `@rawdash/client` SDK (`http().getWidgets()`) unwraps `.widgets` internally, so consumers using the SDK still receive `CachedWidgetData[]` and need no changes. Anyone calling the HTTP endpoint directly (without the SDK) needs to read from the `widgets` field.

### Patch Changes

- Updated dependencies [7adee87]
- Updated dependencies [8ee5006]
  - @rawdash/core@0.11.0

## 0.10.1

## 0.10.0

## 0.9.0

## 0.8.0

## 0.7.1

## 0.7.0

## 0.6.1

## 0.6.0

## 0.5.0

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

## 0.2.0

## 0.1.0
