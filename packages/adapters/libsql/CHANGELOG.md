# @rawdash/adapter-libsql

## 0.7.0

### Minor Changes

- 717eefb: Gate the legacy-baseline branch in `applyMigrations`/`migrateIfNeeded` behind a new `assumeLegacyBaselineIfEventsExists` option. Previously, any database with a stray `events` table but no `schema_migrations` table would have all migrations marked applied without running them, leaving the schema partially-formed. Now the legacy-baseline behavior only triggers when callers explicitly opt in. `LibsqlStorage` (with the default `initSchema: true`) opts in via `initLibsqlSchema`, preserving OSS backwards-compatibility. Callers that pass `initSchema: false` and invoke `applyMigrations`/`migrateIfNeeded` directly against fresh databases (e.g. cloud per-tenant DBs) now reliably get real migrations.

### Patch Changes

- @rawdash/core@0.7.0

## 0.6.1

### Patch Changes

- @rawdash/core@0.6.1

## 0.6.0

### Minor Changes

- ebfa929: Add `migrateIfNeeded(client)` helper for cheap, idempotent schema bootstrap. Uses a single-roundtrip probe to check whether the latest bundled migration is already applied, and delegates to `applyMigrations` only when missing or stale. Lets callers safely run schema bootstrap on every connection open without paying the full migration-check cost on the happy path.

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
