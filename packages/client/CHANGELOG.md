# @rawdash/client

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
