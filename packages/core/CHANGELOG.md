# @rawdash/core

## 0.28.1

### Patch Changes

- 8d02825: Add an optional `replaceWindow` to `StorageHandle.metrics()` and `StorageHandle.distributions()`. When provided (`{ start, end }`, inclusive on both bounds), only rows for the scoped names whose `ts` falls inside the window are deleted before the new samples are inserted, instead of replacing the full history for those names. Omitting `replaceWindow` keeps the existing full delete-by-name behavior, so this is fully backward compatible. This lets connectors that re-pull only a partial window refresh just that window without wiping previously retained history.

## 0.28.0

### Minor Changes

- 0e4102e: Enforce the metric-shape contract so a widget `field` is portable across connectors. Metric resources may now declare `measures` (secondary numerics carried in `attributes`) alongside `dimensions`; the primary numeric always lives in `value` and must never be mirrored into an attribute. `defineResources` rejects metric dimensions/measures named `value`, `name`, or `ts`, and duplicate field names. Metric `field` validation now runs even when a metric declares no dimensions — a `field` that isn't `value`, a declared dimension, or a declared measure is rejected (closing the silent-zero gap where `field: 'count'` summed a missing attribute to `0`).

  Adds a producer-side enforcement helper: `metricSample(resources, name, { ts, value, attributes })` types `attributes` to the named resource's declared dimensions/measures so an undeclared key (or a mirrored value) fails to typecheck.

- 204204a: Widgets can now combine data from multiple connectors. A widget's `metric` accepts either a single `ComputedMetric` (unchanged) or an array of metrics — one per connector — each with its own `name`/`field`/`fn`. Resolved widgets expose a per-connector `series[]` on `CachedWidget`, and `StatusWidget.source` accepts a list of connectors for a combined worst-of health badge.

  An optional `aggregate: { fn }` on a widget merges the per-connector series server-side into the top-level `data`. The same merge is available client-side via the new `mergeSeries` / `mergeSeriesScalar` helpers (exported from `@rawdash/core`, `@rawdash/sdk-client`, and `@rawdash/sdk-nextjs`).

  Single-connector widgets are unchanged on the wire. The `metric` and `source` config types widen to unions, which is a type-level breaking change for code that introspects widget configs.

## 0.27.0

## 0.26.0

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

## 0.24.0

### Minor Changes

- fe1ee4b: Make `computeRetention` spec-driven and watermark-aware with entity coverage.
  - Replace `RetentionConfig { maxAge }` input with a new `RetentionSpec` type that accepts per-resource `FetchSpec[]` and rollup watermarks
  - A raw row is deleted only when it falls outside every live FetchSpec keep-set AND its timestamp is before the rollup watermark (already folded into buckets)
  - Extend `RetentionDeletionPlan` and `computeRetention` to include entities
  - Entity rows are kept if they match any live spec filter (no-window specs keep matching entities indefinitely); a configurable `gracePeriodMs` protects recently-updated entities from immediate deletion after they leave all keep-sets
  - Add `RetentionSpec` to the public core exports
  - `selectForDeletion` and `RetentionConfig` are preserved for backward compatibility with the server retention path

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

## 0.23.0

### Minor Changes

- e6d5f18: Fix event/metric/distribution metrics silently computing 0 when keyed by `entityType` instead of `name` (RAW-534). Previously only the `entity` branch fell back from `entityType` to `name`; the `event`, `metric`, and `distribution` branches read `metric.name` only, so a schema-valid metric that set `entityType` (e.g. a `workflow_runs` event metric with `entityType: 'workflow_run'`) queried with `name: undefined` and returned 0 despite ingested data. All name-keyed shapes now fall back to `metric.name ?? metric.entityType`, restoring symmetry with the entity branch. Additionally, `computedMetricSchema` now requires at least one of `name`/`entityType`, so a metric that identifies no data fails loudly at deploy/validate time instead of rendering 0.
- 8bce1e2: **Breaking:** `filterable` is now a required field on `entity` and `event` resources.

  Resources with `shape: 'entity'` or `shape: 'event'` must declare a
  `filterable: ResourceFilterField[]` array — use `[]` to explicitly state that the source
  cannot filter any field server-side. `metric`, `distribution`, and `edge` resources do
  **not** carry `filterable` (they are pre-aggregated / structural, so there is nothing to
  push down). `defineResources` throws if an entity/event resource omits `filterable`, or if
  any entry has an empty `field` or no operators.

  Membership in `filterable` is the server-side pushdown signal: a widget filtering on a
  declared field has that filter pushed to the source query; any other field is still
  filtered client-side by compute (no declaration needed). Connectors translate their
  declared filters into source query params in the fetch loop (e.g. GitHub/GitLab/Bitbucket
  `state`, Sentry issue `status`/`level`, Stripe subscription/invoice `status`, Vercel
  deployment `state`/`target`, Netlify deploy `state`, Jira/Linear/HubSpot/Datadog/Intercom
  status/stage filters).

  Third-party connector authors must add `filterable` to every entity/event resource in
  their `defineResources` call.

- 1159dc1: Validate widget metric definitions against connector resource schemas.

  `@rawdash/core` now exports `validateConfigMetrics(config, resourcesByConnectorId)` (plus `resourcesByConnectorIdFromRegistry` to derive that map from a `ConnectorRegistry`). It checks every widget metric against the referenced connector's declared resources and reports:
  - **Errors** for a metric that references an unknown resource name, a shape that doesn't match the resource, or a field (including filter/groupBy fields) the resource doesn't declare — each message lists the valid options.
  - **Warnings** for aggregating a field declared in a minor currency unit (e.g. Stripe `amount` in cents) without conversion, and for a metric whose title/name implies a time window but has no effective `window`.

  Validation runs server-side, where the connector registry (and therefore every connector's schema) already lives: the engine exposes a `POST /config/validate` route (`@rawdash/hono` `createConfigValidateRouter`, mounted by `mountEngine`). `rawdash deploy` calls this route and fails on errors / surfaces warnings before applying, and degrades gracefully if the server doesn't expose it. The CLI no longer bundles the connector packages.

  `ResourceField` gains an optional `unit`, and the Stripe connector declares its monetary fields (`amount`, `mrrAmount`, `amountDue`, `amountPaid`) in `cents` so the cents-without-conversion warning is driven by the connector's own schema.

### Patch Changes

- 2816c8a: Add incremental aggregation rollups (RAW-520). `@rawdash/core` now owns a bucket-based rollup mechanism so unbounded aggregates can be answered after raw rows are dropped: an incremental-merge primitive for the mergeable `AggFn`s (`count`/`sum`/`avg`/`min`/`max`/`latest`/`first`), `computeRollupSpecs` to derive the rollup dimension set and bucket granularity from widget configs, a `foldResourceRollups` fold step that folds only complete past buckets and advances a per-resource watermark, and a bucket-aware read path wired into `computeMetric` that merges materialized buckets with the raw tail since the watermark. New optional `StorageHandle` methods (`writeRollups`/`queryRollups`/`getRollupWatermark`/`setRollupWatermark`) are implemented in `InMemoryStorage` and the libsql adapter (new `rollups` + `rollup_watermarks` tables). The watermark lets retention safely drop raw `ts < watermark` outside live keep-sets.
- f7346f2: `defineMetric` now defaults `field` to `'value'` for metric-shape resources when omitted, matching the implicit `value` column metric records store. This fixes ~16 connector `example.config.ts` files (and any metric-shape widget using `fn: 'sum'`/`avg`/etc. without an explicit `field`) that failed to load with `field is required unless fn is "count"`.

## 0.22.0

### Minor Changes

- 851d1f1: Add `@rawdash/connector-app-store-connect` — syncs the team's iOS/macOS apps, daily sales (units and developer proceeds), and a rolling sample of customer review ratings from the App Store Connect REST API into the six-shape storage model. Authenticates with an ES256-signed JWT minted per request from an issuer ID, key ID, and a PKCS#8 EC private key (.p8). Sales reports are fetched as gzipped TSV (DAILY frequency, SALES SUMMARY) and broken out by `(date, app, country, productTypeIdentifier)`; revenue samples preserve each row's native "Currency of Proceeds" so downstream widgets can group or FX-convert. App ratings are sampled from each app's most-recent N customer reviews (default 200, capped at 2,000) and emitted as a metric with rating 1-5 as the value and territory on the attribute, since Apple does not expose lifetime aggregates over the REST API. Per-build crash counts (`app_crashes`) are intentionally deferred — they require the asynchronous Analytics Reports request/poll/download flow which is a follow-up. A new `mobile` connector category is added to `@rawdash/core` so this and future mobile connectors land in a dedicated docs vertical.
- beb78ff: Require a `domain` field on connector vendor metadata, and give each connector a vendor domain.

  `connectorDocSchema` now requires `vendor.domain` (a validated hostname), so every connector declares the vendor's domain. This is a breaking change for connector authors using `@rawdash/core` directly. All built-in connectors now set `vendor.domain`.

- afbf954: Carry widget filters into connector fetch via per-resource FetchSpecs.

  `@rawdash/core` now models backfill output as `ResourceBackfill { specs: FetchSpec[] }` (was `{ requiredWindowMs }`), merging per resource so same-filter specs collapse to the loosest window while different filter sets are kept apart. Adds `fetchSpecsForConnector`, `SyncOptions.fetchSpecs`, `resolveSpecCutoff`, optional `filterable` on resource definitions, and per-spec cursor support in `paginateChunked`. The GitHub connector pushes recognized `state` filters down to the API and applies a per-spec cutoff; the OSS sync runner routes through `fetchSpecsForConnector` so OSS and cloud share one fetch path.

## 0.21.1

## 0.21.0

### Minor Changes

- 37f1083: `paginateChunked` now defaults `maxChunkMs` to `DEFAULT_MAX_CHUNK_MS` (30s) when omitted, so every connector's `sync()` returns a graceful, resumable chunk boundary on a wall-time budget instead of paginating an entire resource in a single call. Heavy connectors (e.g. github-actions) now complete a sync as a series of short, bounded chunks rather than relying on the caller's `AbortSignal`. Low-volume connectors are unaffected — they still finish in one chunk. Callers that want unbounded pagination can pass `maxChunkMs: Infinity`.

### Patch Changes

- c796c09: Bound full-sync fetch volume by the widget-declared window. `SyncOptions` gains an optional `requiredWindowMs` map (keyed by resource) and a new `resolveBackfillCutoff` helper merges it with `since` into a single lower bound. The GitHub connector now honors this window when paginating `workflow_runs`, `pull_requests`, `issues`, `deployments`, and `releases`, so an initial sync only pulls as much history as the dashboard's widgets require. A windowless widget still triggers an unbounded fetch, and behavior is unchanged when no window is supplied.

## 0.20.0

### Patch Changes

- 055d978: Add `@rawdash/connector-greenhouse` — syncs Greenhouse Harvest data into the six-shape storage model: jobs, candidates, applications, and offers as entities (with department/office, current stage, source, status, and the timestamps that drive funnel widgets), plus application lifecycle events (`applied` / `hired` / `rejected`) derived from each application's built-in timestamps. Authenticates via HTTP Basic with a single Harvest API key as the username (no per-resource token rotation), follows the RFC 5988 `Link: rel="next"` header for pagination, and threads `options.since` through as the `updated_after` filter on every paginated phase so incremental ticks stay cheap under the 50 req / 10 s key quota. A new `hr` connector category is added to `@rawdash/core` so this and future HR / ATS connectors land in a dedicated docs vertical.
- 66d2e20: Speed up high-volume connector syncs from `@rawdash/core`. `SyncOptions` gains an optional `pageSize` so the page size can be tuned at sync time (e.g. from the cloud `toOssSyncOptions`) without a connector release. `paginateChunked` gains two opt-in options: `maxChunkMs`, a soft per-chunk wall-clock budget that yields a resumable cursor once exceeded so a long phase is checkpointed across queue round-trips instead of one marathon invocation; and `pipeline`, which overlaps the fetch of the next page with the write of the current one (exactly one fetch and one write in flight at a time, preserving rate limits and write ordering). Both default off, so existing callers are unaffected.
- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.

## 0.19.0

### Minor Changes

- 725ebcc: `paginateChunked` now re-throws non-retryable HTTP errors (`AuthError`, `ClientBugError`) instead of collapsing them into a resumable `transientError` pinned to the current cursor. Previously any error from `fetchPage`/`writeBatch` was returned as a `transientError` at the same page, so a 401 (token revoked), 403, 404, or 422 told the consumer to "resume here" and the identical request was retried forever until the chunk cap, masking the real cause. Genuinely retryable errors (`TransientError`, `UpstreamBugError`, `RateLimitError`) and clean aborts still return a resumable boundary as before. Callers that drive `paginateChunked` should be prepared for a thrown typed error on permanently-failing syncs.

## 0.18.0

## 0.17.0

## 0.16.0

### Minor Changes

- 422b711: Support composite (object) secret values via `secret()` references.
  - `@rawdash/core`: add `withSecretRef(schema)` helper for connector authors to declare credential fields that accept either a fully-resolved value (string, object, array, …) or a `{ $secret: 'NAME' }` reference. Extend `EnvSecretsResolver` with a JSON-parse heuristic: env var values starting with `{` or `[` are parsed as JSON; anything else (including PATs like `ghp_…`) stays a string. `SecretsResolver.resolve` is now typed `unknown` instead of `string | undefined` to allow resolved object/array values — implementers of the interface should widen accordingly.
  - `@rawdash/cli`: `rawdash secrets set <NAME>` now accepts `--json '<inline json>'` and `--from-file <path>`. Both validate that the input parses as JSON before any network call; combining either with a positional value (or with each other) errors. The plaintext is forwarded as-is to the secret store, and the runtime resolver parses it back on use.

- 79fdd64: Connectors can now expose `count()` / `latest()` aggregate operations and the runner calls them directly instead of paginating entities for single-scalar stat widgets.

  `Connector` gains an optional `aggregate(req, signal)` method. Core ships `classifyWidget(widget)` to bucket each widget into `{ via: 'aggregate' | 'entity-sync' }` — aggregate-eligible widgets are plain `stat` widgets whose `fn` is `count` or `latest` with no `window`, no `groupBy`, and (for `latest`) a `field`. `runSync` now:
  1. Walks every widget targeting the connector, runs `connector.aggregate(...)` in parallel for the aggregate-eligible ones, and stores the scalar under an `__widget_aggregate` entity (`getEntity(AGGREGATE_ENTITY_TYPE, widgetId)`).
  2. Drops a resource from the entity-sync allowlist only when every widget using it is aggregate-served. When the resulting allowlist is empty the entity-sync pass is skipped entirely.
  3. `resolveWidget` reads the cached aggregate scalar first for aggregate-eligible widgets, falling back to `computeMetric` when no scalar has been written yet.

  The GitHub connector implements `aggregate` against efficient REST endpoints: `/repos/X` for `repo` stars/forks/watchers, `/search/issues` (`total_count`) for `pull_request` / `issue` counts, `/repos/X/contributors?per_page=1` for the contributor count (parsed from the `Link` header), and `/repos/X/actions/runs?per_page=1` for the latest `workflow_run`. For the `example-nextjs` dashboard, a cold-start sync collapses from ~600 paginated requests to ~7 single requests.

  `FilterClause` / `FilterCondition` / `FilterOperator` moved to a dedicated `filters.ts` module and are re-exported from both `config` and the package root — no source change for consumers.

- 074ec25: Generate connector documentation from connector metadata, and unify per-resource metadata.
  - `@rawdash/core`: add `defineResources()` / `schemasFromResources()` and the `ResourceDefinition` type. A connector now declares each stored resource once (shape, description, endpoint, fields/dimensions, notes, and the API-response Zod schema(s) under `responses`); `ConnectorClass.schemas` is derived from these instead of being a separate central map. Connectors expose `static resources` + `static schemas = schemasFromResources(...)`.
  - `@rawdash/core`: add `defineConnectorDoc()` for the connector-level docs metadata (display name, category, brandColor, tagline, vendor, auth, rateLimit, limitations). Per-resource docs moved to `resources`; the runnable example moved to a type-checked `src/example.config.ts` per connector. Add the optional `ConnectorCost` contract field (`static cost`) so connectors can report recommended sync interval and cost/quota warnings.
  - Each connector's `README.md` and the website's `/docs/connectors` pages (one per connector plus a catalog index, per-connector brand icons, and the landing-page grid data) are generated from this metadata via `pnpm docs:connectors`. CI enforces freshness and a no-em-dash rule with `pnpm docs:connectors:check`.
  - `@rawdash/connector-test-utils`: `connectorResourceShapeViolations` / `assertConnectorResourceShapes` verify that every resource a connector writes is declared and that the declared `shape` matches what is written to storage.

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

- e8b014a: Scope OSS sync to widget-referenced resources, not just connectors.

  `computeConnectorBackfill` now returns per-resource scope (`Map<connectorName, Map<resourceName, { requiredWindowMs }>>`) so the runner knows which resources each widget actually references. **Breaking** for direct consumers of `computeConnectorBackfill`: the return shape gained an inner `Map<resourceName, ResourceBackfill>` layer where it previously held a single `ConnectorBackfill` per connector. Status widgets register their connector with an empty inner map.

  `SyncOptions` gains an optional `resources?: ReadonlySet<string>` allowlist. `runSync` derives it (plus the max window across resources) from the per-resource scope and threads it into every `connector.sync` call. Connectors that don't read the option keep their current behavior.

  The GitHub connector now gates its phases on the allowlist via a `PHASE_RESOURCES` map — dashboards that don't reference `deployment`, `release`, or `contributor` no longer page through `/deployments`, `/deployment_statuses`, `/releases`, or `/stats/contributors`. An empty allowlist (status-only configs) short-circuits to `done: true` so the sync run still completes for connector-health tracking without hitting upstream.

- 7060534: **New:** `@rawdash/sdk-runtime` — framework-agnostic auto-polling subscription engine that drives client-side dashboards from the schedule the server already publishes (`cachedAt` + `syncIntervalSeconds` on each `CachedWidget`).

  Per-widget state machine handles every `WidgetSyncState` branch: `fresh` advances notify subscribers and sleep until the next expected sync; mid-flight `syncing` polls fast (capped); late syncs back off (3s → 6s → 12s, capped at 30s) and resume normal scheduling after 2× the interval; `failing` / `stale` fires once and backs off ≥ 1 min; `unsynced` polls moderately. Pauses when `document.hidden` and resumes on visibility/focus.

  **Wire:** `CachedWidget` now carries `syncIntervalSeconds?: number` so clients can schedule polling without an extra request.

  **Next.js:** `@rawdash/sdk-nextjs` exposes client-side hooks at the `/client` subpath:

  ```tsx
  'use client';

  import { http } from '@rawdash/sdk-nextjs';
  import { useDashboard, useWidget } from '@rawdash/sdk-nextjs/client';

  const source = http({ baseUrl: '/rawdash' });

  export function MyWidget() {
    const { widget } = useWidget(source, 'main', 'revenue');
    return <div>{widget?.data}</div>;
  }
  ```

  Hooks add `react >= 18` as a peer dependency. Server-side `createRawdashClient` / `revalidateTag` flow is unchanged — import it from `@rawdash/sdk-nextjs` as before.

- d17a523: **New:** ETag / `If-None-Match` on the per-widget endpoint (`GET /dashboards/:id/widgets/:widgetId`). Turns no-op polls from the subscription engine (RAW-323) into cheap `304 Not Modified` responses, skipping `resolveWithCache` (and the underlying `resolveWidget` + connector storage hits) entirely on match.

  The ETag is `"<lastSyncAt>-<configHash>"`. Including `configHash` ensures a widget-config edit invalidates the cached ETag even when `lastSyncAt` hasn't advanced.
  - `@rawdash/core` — new exports: `computeWidgetEtag`, `hashWidgetConfig`.
  - `@rawdash/server` — `getWidget` signature changed: now accepts `{ cache?, ifNoneMatch? }` options and returns `{ status: 'ok', etag, widget } | { status: 'not-modified', etag }`. Breaking change for callers that consume `getWidget` directly; `@rawdash/hono` is updated.
  - `@rawdash/hono` — widget router emits `ETag` on 200 and `304` when `If-None-Match` matches.
  - `@rawdash/sdk-client` — `http()` transparently caches the last-seen ETag per `(dashboardId, widgetId)`, sends `If-None-Match` on subsequent fetches, and returns the cached body on 304.

  The bundle endpoint (`GET /dashboards/:id/widgets`) is intentionally out of scope. No changes in `@rawdash/sdk-runtime`.

### Patch Changes

- a1c4c66: Extract shared connector boilerplate across six connectors. No behavior change for connector consumers; everything below is internal refactor.
  - `@rawdash/core` gains `makeChunkedCursorGuard(phases)`, `selectActivePhases(resourceToPhase, order, enabled)`, and `BaseConnector.isResourceEnabled<R>(resource)`. These replace hand-rolled copies that had accumulated across vercel/sentry/linear/stripe/github.
  - The internal `@rawdash/connector-shared` substrate gains `standardRateLimitPolicy({ remainingHeader, resetHeader, resetUnit, resetFallbackMs? })`, `sanitizeAllowedUrl({ url, host, pathname, protocol? })`, `parseEpoch(value, 'ms' | 's' | 'iso')`, and `connectorUserAgent(id)`. The vendor-named `githubRateLimit` / `sentryRateLimit` / `linearRateLimit` exports are gone — each connector now builds its policy from `standardRateLimitPolicy`, including vercel which previously rolled its own.
  - Property-test fetch-mock scaffolding (`mockResponse`, `installFetchMock`, `entityStoreFor`, `eventStoreFor`, `metricStoreFor`) was duplicated byte-for-byte in every connector's `property.test.ts`; it now lives in `@rawdash/connector-test-utils`.

  Net effect for downstream packages: identical behavior, ~200 fewer lines per connector, one place to fix when the substrate evolves.

- 5026a5b: Make `ServerStorage.markSyncRunning` optional. It's an in-process-only concern: `runSync` calls it to acquire the `queued → running` lock. Deferred-mode storages (where an external runner drives the `running → succeeded/failed` transitions via its own aggregation) may now omit `markSyncRunning` entirely — `runSync` and the MCP `trigger_sync` tool both skip the call when it's absent. In-process storages (`InMemoryStorage`, `LibsqlStorage`) still implement it; no behavior change for in-process users.
- d52a6a8: Scope OSS sync to widget-driven backfill windows.

  `runSync` previously called every configured connector with `mode: 'full'` and no `since`, so connectors paginated all of upstream history on every sync — blowing past the 1000-chunk safety cap on real-world repos and making the example dashboards un-syncable.

  `computeConnectorBackfill` (new in `@rawdash/core`) walks `config.dashboards.*.widgets`, groups them by connector name, and computes the max window per connector. Status widgets count as references; current-state widgets with no window keep the connector in the map but leave the window undefined.

  `runSync` now skips connectors with zero referencing widgets, and passes `since = now − requiredWindow − 1d buffer` whenever a window is present.

  The GitHub connector honors `since` on `pull_requests` (sorted by `updated` desc and stopping at the cutoff), `deployments`, and `releases`. Sentry, Linear, Stripe, Vercel, and Google Analytics also honor `since` under `mode: 'full'` so the widget-driven window flows end-to-end. Stripe subscriptions are intentionally exempt from the `created[gte]` cutoff in full mode because subscription `updated_at` is derived from `current_period_end` and a still-active subscription created before the cutoff would otherwise be dropped.

## 0.15.0

### Minor Changes

- 1ad2bc0: Enforce `static schemas` on every connector via the `ConnectorClass` contract.

  `ConnectorClass` in `@rawdash/core` now requires a `readonly schemas: Readonly<Record<string, z.ZodType>>` map of resource name → Zod schema describing the raw API response shape. The keys must match the `resource` tag passed to `request()`. Building a `ConnectorRegistry` with a connector class that lacks `schemas` is now a TypeScript compile error.

  The cloud baseline generator walks this map at deploy time to populate `connector_baselines`, which drives the shape-drift detection pipeline. Without `schemas`, the generator skipped every connector and the pipeline sat dormant; enforcing it at the type level prevents that from happening again.

  All four shipping OSS connectors (`@rawdash/connector-github`, `@rawdash/connector-stripe`, `@rawdash/connector-linear`, `@rawdash/connector-google-analytics`) and `@rawdash/connector-sentry` now expose `static schemas` matching their full resource set. Property tests in each connector consume schemas via `runPropertySyncTest({ connectorClass, resource })`, so a dropped or misnamed key breaks that connector's own property tests in addition to failing typecheck at the registry site.

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
