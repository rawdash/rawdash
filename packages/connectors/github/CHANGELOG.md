# @rawdash/connector-github

## 0.27.0

### Patch Changes

- @rawdash/core@0.27.0

## 0.26.0

### Patch Changes

- @rawdash/core@0.26.0

## 0.25.0

### Patch Changes

- 1e1dc00: Fix incremental-sync data loss in list endpoints GitHub does not contractually order, and drop an invalid pull-request `state` filter value.
  - `workflow_run`: workflow runs mutate after creation (a re-run changes `status`/`conclusion` for up to ~30 days), and `GET /actions/runs` is ordered by `created_at` descending with no `updated`-since filter, so an old run that was re-run recently sits deep in the list. The early-exit now pages back by a ~32-day re-run look-back (stops only when `created_at < cutoff - 32d`) while still admitting any run whose `updated_at` is within the window, so recently re-run runs are no longer dropped on incremental syncs.
  - `release`: `GET /releases` order is not guaranteed, so short-circuiting/filtering on `published_at ?? created_at` could terminate early and drop in-window releases (e.g. a long-lived draft published recently). Now filters client-side on `created_at` only and pages to the end of the window; `published_at` is still stored as an attribute.
  - `deployment`: `GET /deployments` does not document a `created_at` ordering and deployments churn status, so the `created_at` early-break could drop in-window rows. Now pages fully within the window and relies on the client-side filter.
  - `pull_request`: removed the invalid `merged` value from the declared `state` filter — `GET /pulls` `state` only accepts `open`, `closed`, or `all` (merged PRs are `closed` with `merged_at` set), so a `state == merged` filter was silently ignored.
  - `issue`: pin `sort=updated&direction=asc` for deterministic ordering (the `since` filter already bounds the set).

- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0

## 0.24.0

### Patch Changes

- 5c07c18: Fix mis-windowing in GitHub connector: `specCutoff` now respects the `since` backfill buffer when `fetchSpecs` are present, ensuring `open_prs` and `workflow_runs` are not dropped near the window boundary.
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

- beb78ff: Require a `domain` field on connector vendor metadata, and give each connector a vendor domain.

  `connectorDocSchema` now requires `vendor.domain` (a validated hostname), so every connector declares the vendor's domain. This is a breaking change for connector authors using `@rawdash/core` directly. All built-in connectors now set `vendor.domain`.

- afbf954: Carry widget filters into connector fetch via per-resource FetchSpecs.

  `@rawdash/core` now models backfill output as `ResourceBackfill { specs: FetchSpec[] }` (was `{ requiredWindowMs }`), merging per resource so same-filter specs collapse to the loosest window while different filter sets are kept apart. Adds `fetchSpecsForConnector`, `SyncOptions.fetchSpecs`, `resolveSpecCutoff`, optional `filterable` on resource definitions, and per-spec cursor support in `paginateChunked`. The GitHub connector pushes recognized `state` filters down to the API and applies a per-spec cutoff; the OSS sync runner routes through `fetchSpecsForConnector` so OSS and cloud share one fetch path.

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0

## 0.21.1

### Patch Changes

- 0ea575d: Fix cursor resume resetting to page 1 when GitHub's pagination Link header uses the numeric repo ID URL form (`/repositories/:id/...`) instead of the canonical owner/repo form. `sanitizePageUrl` now accepts both forms, so a chunk that hits the `maxChunkMs` budget correctly resumes from the next page on the following alarm invocation.
  - @rawdash/core@0.21.1

## 0.21.0

### Patch Changes

- c796c09: Bound full-sync fetch volume by the widget-declared window. `SyncOptions` gains an optional `requiredWindowMs` map (keyed by resource) and a new `resolveBackfillCutoff` helper merges it with `since` into a single lower bound. The GitHub connector now honors this window when paginating `workflow_runs`, `pull_requests`, `issues`, `deployments`, and `releases`, so an initial sync only pulls as much history as the dashboard's widgets require. A windowless widget still triggers an unbounded fetch, and behavior is unchanged when no window is supplied.
- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Patch Changes

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

- 621b32f: Expand GitHub issues `labels[]` schema with optional id/node_id/url/color/default/description; make issue `closed_at` optional (shape-drift RAW-347).
- c33b2ef: Expand GitHub releases schema with optional author sub-fields and top-level fields (assets, body, urls, etc.) (shape-drift RAW-362)
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

- e104540: GitHub connector: extend `aggregate()` with `latest(release, field)`, richer count filters, structured INFO logs, and a new `validateCountFilter` hook.
  - `latest(release, field)` now hits `GET /repos/O/R/releases/latest` and returns `tag_name`, `name`, `author`, or `published_at` in a single API call (previously fell back to entity-sync over `/releases?per_page=100`).
  - Count filter translation now supports `state`, `label`, `author`, `assignee`, `milestone`, `draft`, `head`, and `base` — mapped to the matching `is:` / `label:` / `author:` etc. GitHub Search qualifiers. Unsupported operators (anything other than `eq`) and unknown fields are rejected with a descriptive error.
  - `count(repo)` and `count(workflow_run)` are now rejected explicitly rather than silently routed to the `latest` code path.
  - Each aggregate call emits a structured `info` log (`[github-actions] aggregate fn=count resource=pull_request query="repo:o/r is:pr is:open" value=194 via="search API"`) — one line per aggregate, matching the cadence introduced by the progress-log work.

  Core: `Connector` gains an optional `validateCountFilter(resource, filter)` hook so config-time validation can reject unsupported filter combinations before the first sync. The GitHub connector implements it by re-using its runtime translation table.

- 9169ceb: GitHub connector: gate N+1 reviews/statuses sub-fetches on a resource allowlist.

  Adds an optional `resources?: ReadonlyArray<string>` field to `SyncOptions`. When set, the GitHub connector skips the per-PR `GET /pulls/{n}/reviews` fan-out unless `pull_request_reviews` is in the allowlist, and skips the per-deployment `GET /deployments/{id}/statuses` fan-out unless `deployment_statuses` is in the allowlist. When `resources` is unset, behavior is unchanged — both sub-resources are still fetched.

  This eliminates the dominant source of wasted API calls when a dashboard only needs PR / deployment counts. Combined with the existing `since`-aware page filtering (sub-fetches already only run for survivors of the cutoff), real-world repos like `rawdash/rawdash` no longer blow past the 5-min sync budget on the example dashboard.

  The runner that actually computes and passes the allowlist is wired up separately.

- c27c332: Remove the connector-level `aggregate()` query fast-path; connectors are now pure resource syncers and the engine owns all query-time aggregation.

  `Connector` no longer exposes `aggregate()` or `validateCountFilter()`, and the `AggregateRequest` / `AggregateValue` types, `classifyWidget`, `readAggregate`, and `writeAggregate` are removed from `@rawdash/core`. During sync the runner no longer dispatches `connector.aggregate()`, writes `__widget_aggregate` rows, or drops resources from the entity-sync allowlist — every in-scope resource is entity-synced and `resolveWidget` always evaluates the metric via `computeMetric` over synced rows.

  The `github` and `hubspot` connectors drop their `aggregate()` / `validateCountFilter()` implementations. Correctness is unchanged; this only trades extra sync volume for a uniform, decoupled contract. Widget-level aggregation (`defineMetric({ fn: 'count', ... })` → `computeMetric`) and natively metric-shaped sources (CloudWatch, Cost Explorer, Google Analytics) are unaffected.

### Patch Changes

- 79fdd64: Connectors can now expose `count()` / `latest()` aggregate operations and the runner calls them directly instead of paginating entities for single-scalar stat widgets.

  `Connector` gains an optional `aggregate(req, signal)` method. Core ships `classifyWidget(widget)` to bucket each widget into `{ via: 'aggregate' | 'entity-sync' }` — aggregate-eligible widgets are plain `stat` widgets whose `fn` is `count` or `latest` with no `window`, no `groupBy`, and (for `latest`) a `field`. `runSync` now:
  1. Walks every widget targeting the connector, runs `connector.aggregate(...)` in parallel for the aggregate-eligible ones, and stores the scalar under an `__widget_aggregate` entity (`getEntity(AGGREGATE_ENTITY_TYPE, widgetId)`).
  2. Drops a resource from the entity-sync allowlist only when every widget using it is aggregate-served. When the resulting allowlist is empty the entity-sync pass is skipped entirely.
  3. `resolveWidget` reads the cached aggregate scalar first for aggregate-eligible widgets, falling back to `computeMetric` when no scalar has been written yet.

  The GitHub connector implements `aggregate` against efficient REST endpoints: `/repos/X` for `repo` stars/forks/watchers, `/search/issues` (`total_count`) for `pull_request` / `issue` counts, `/repos/X/contributors?per_page=1` for the contributor count (parsed from the `Link` header), and `/repos/X/actions/runs?per_page=1` for the latest `workflow_run`. For the `example-nextjs` dashboard, a cold-start sync collapses from ~600 paginated requests to ~7 single requests.

  `FilterClause` / `FilterCondition` / `FilterOperator` moved to a dedicated `filters.ts` module and are re-exported from both `config` and the package root — no source change for consumers.

- a1c4c66: Extract shared connector boilerplate across six connectors. No behavior change for connector consumers; everything below is internal refactor.
  - `@rawdash/core` gains `makeChunkedCursorGuard(phases)`, `selectActivePhases(resourceToPhase, order, enabled)`, and `BaseConnector.isResourceEnabled<R>(resource)`. These replace hand-rolled copies that had accumulated across vercel/sentry/linear/stripe/github.
  - The internal `@rawdash/connector-shared` substrate gains `standardRateLimitPolicy({ remainingHeader, resetHeader, resetUnit, resetFallbackMs? })`, `sanitizeAllowedUrl({ url, host, pathname, protocol? })`, `parseEpoch(value, 'ms' | 's' | 'iso')`, and `connectorUserAgent(id)`. The vendor-named `githubRateLimit` / `sentryRateLimit` / `linearRateLimit` exports are gone — each connector now builds its policy from `standardRateLimitPolicy`, including vercel which previously rolled its own.
  - Property-test fetch-mock scaffolding (`mockResponse`, `installFetchMock`, `entityStoreFor`, `eventStoreFor`, `metricStoreFor`) was duplicated byte-for-byte in every connector's `property.test.ts`; it now lives in `@rawdash/connector-test-utils`.

  Net effect for downstream packages: identical behavior, ~200 fewer lines per connector, one place to fix when the substrate evolves.

- a2d6e6d: Relax `issues` Zod schema to tolerate additional GitHub API fields surfaced by shape-drift detection (RAW-339).

  All newly observed fields on `$[*]` and `$[*].user` are accepted as optional, and `user` allows unknown keys via `catchall`. `closed_at` is intentionally left as `iso.datetime().nullable()` even though the latest sample showed only `string` — the existing nullable shape reflects API reality for open issues. No behavioral changes to sync or aggregate paths.

- d08fcfc: Extend `pull_requests` Zod schema with newly observed GitHub API fields (forward-compat shape drift). All new fields are optional to remain tolerant of partial payloads.
- 681c49b: Extend the `workflow_runs` Zod schema to accept newly-observed GitHub API fields (`artifacts_url`, `display_title`, `event`, `head_sha`, `html_url`, `run_number`, `run_started_at`, `triggering_actor`, `url`, `workflow_id`, etc., plus top-level `total_count`). All new fields are `.optional()` so older payloads still validate. Nullable type-changes on `conclusion`, `head_branch`, and `actor` are intentionally left as-is since existing sync code handles nulls defensively.
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
