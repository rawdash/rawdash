# @rawdash/connector-github

## 0.15.0

### Minor Changes

- 1ad2bc0: Enforce `static schemas` on every connector via the `ConnectorClass` contract.

  `ConnectorClass` in `@rawdash/core` now requires a `readonly schemas: Readonly<Record<string, z.ZodType>>` map of resource name → Zod schema describing the raw API response shape. The keys must match the `resource` tag passed to `request()`. Building a `ConnectorRegistry` with a connector class that lacks `schemas` is now a TypeScript compile error.

  The cloud baseline generator walks this map at deploy time to populate `connector_baselines`, which drives the shape-drift detection pipeline. Without `schemas`, the generator skipped every connector and the pipeline sat dormant; enforcing it at the type level prevents that from happening again.

  All four shipping OSS connectors (`@rawdash/connector-github`, `@rawdash/connector-stripe`, `@rawdash/connector-linear`, `@rawdash/connector-google-analytics`) and `@rawdash/connector-sentry` now expose `static schemas` matching their full resource set. Property tests in each connector consume schemas via `runPropertySyncTest({ connectorClass, resource })`, so a dropped or misnamed key breaks that connector's own property tests in addition to failing typecheck at the registry site.

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

- a517005: Fix silent overwrite on duplicate ids in the GitHub connector. The API can legitimately return the same item twice within a single sync (pagination overlap on mutating collections, retried requests, cross-endpoint overlap). Each resource (`workflow_runs`, `pull_requests`, `issues`, `deployments`, `releases`, `contributors`) now dedupes by stable id before writing, using a keep-last strategy, and logs a `console.warn` when duplicates are dropped so the behavior is observable.
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

- 8fd3612: Rename `GitHubActionsConnector` → `GitHubConnector` and `GitHubActionsSettings` → `GitHubSettings`. The connector's scope has expanded beyond GitHub Actions (it now syncs pull requests, issues, deployments, releases, and contributors), so the class name now matches the package name and the vendor-level naming used by sibling connectors (`StripeConnector`, `GA4Connector`).

  Breaking:
  - Replace `import { GitHubActionsConnector } from '@rawdash/connector-github'` with `import { GitHubConnector } from '@rawdash/connector-github'`.
  - Replace `GitHubActionsSettings` with `GitHubSettings` if you import the settings type.

  No behavior change. The connector's storage `id` is unchanged (`github-actions`), so existing synced data and widget `source` strings continue to work without migration.

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

- 533e632: Add `paginateChunked` helper to `@rawdash/core` for resumable phased pagination, and adopt it in `@rawdash/connector-github`. Connectors that hit the Cloudflare Worker subrequest cap mid-sync can now opt-in by declaring an ordered list of phases plus per-page `fetchPage` / `writeBatch` callbacks; the helper handles cursor advancement, abort handling, and phase rollover, so each sync chunk picks up where the previous one left off.

### Patch Changes

- Updated dependencies [533e632]
  - @rawdash/core@0.9.0

## 0.8.0

### Minor Changes

- 28355ff: Extend the `Connector.sync` contract with resumable progress: `SyncOptions.cursor?: unknown` carries opaque resumption state from the host, and `sync()` now returns `SyncResult = { done: boolean; cursor?: unknown }` so chunked syncs can hand control back to the host between pages.

  The github-actions connector now threads a `{ phase, pageUrl }` cursor through all paginated phases (workflow runs, pull requests, issues, deployments, releases) and checks `signal.aborted` at page boundaries. When the host signals a yield, the connector returns the in-progress phase + page URL instead of restarting from scratch on the next chunk — letting large GitHub backfills make forward progress under the cloud worker's subrequest budget.

### Patch Changes

- Updated dependencies [28355ff]
  - @rawdash/core@0.8.0

## 0.7.1

### Patch Changes

- 6d7d0e7: Bundle the internal shared substrate (renamed from `@rawdash/http-client` to `@rawdash/connector-shared`) into the published tarball via tsup `noExternal`, so `npm i @rawdash/connector-github` resolves cleanly without a dangling workspace dependency.
  - @rawdash/core@0.7.1

## 0.7.0

### Patch Changes

- 7172338: Refactor GitHub connector onto the new internal `@rawdash/http-client` package: ad-hoc `fetch` call sites and retry logic are replaced by the shared client, which supplies a default `User-Agent`, typed errors (`AuthError` / `RateLimitError` / `TransientError` / `UpstreamBugError` / `ClientBugError`), retry with backoff and `Retry-After` handling, GitHub rate-limit header parsing, and Link-header pagination.
  - @rawdash/core@0.7.0

## 0.6.1

### Patch Changes

- 32a4b63: Send a `User-Agent` header on all GitHub API requests. GitHub rejects requests without a UA with `403 Forbidden`; this worked locally because Node's `fetch` supplies a default UA, but failed in Cloudflare Workers where `fetch` does not.
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

- Updated dependencies [725ea8a]
  - @rawdash/core@0.2.0

## 0.1.0

### Patch Changes

- Updated dependencies [0f069f7]
  - @rawdash/core@0.1.0
