# @rawdash/connector-sentry

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2

## 0.28.1

### Patch Changes

- 26f0e81: Widen the `issue_events` schema (metadata, tags, user) to accept observed upstream shapes (RAW-726).
- a6b6310: Widen the `issues` schema (annotations, lifetime, metadata, stats, statusDetails) to accept observed upstream shapes (RAW-724).
- 8d06434: Widen the `releases` schema (release + nested projects fields) to accept observed upstream shapes (RAW-731).
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0

## 0.27.0

### Minor Changes

- 12e4144: Fix `sentry_errors_per_hour` emitting zero samples. The `stats_v2` query combined `groupBy=project` with `interval=1h`, for which Sentry returns per-group totals only — no per-group time series and no top-level `intervals` — so the transform had nothing to emit. The query now drops `groupBy=project` and the connector emits the org-wide hourly series (summing across any groups Sentry still returns), with explicit zeros for empty hours so a genuine 0 reads as `0` rather than `no_data`. The per-project `project` dimension is removed from the metric.

### Patch Changes

- 3c75312: Update the `issue_events` schema to accept a null `location` observed in upstream shape drift (RAW-592).
  - @rawdash/core@0.27.0

## 0.26.0

### Patch Changes

- 3e3524f: Fix `sentry_errors_per_hour` writing no samples when `stats_v2` response omits the top-level `intervals` field. Timestamps are now reconstructed from `start` + series length (1h buckets) when `intervals` is absent or empty.
  - @rawdash/core@0.26.0

## 0.25.0

### Patch Changes

- 7e2fc9d: Fix `sentry_errors_per_hour` producing no data points. The org-level `stats_v2` request now sends `project=-1` (all accessible projects) when no specific projects are configured, instead of omitting the `project` param entirely — without it Sentry returns groups with empty series and the metric writes zero rows. Groups that come back with a missing or empty series now emit explicit zero samples for each interval, so a genuine no-error window reads as a real `0` rather than no data.
- 162a6dc: Fix incremental `sentry_release` syncs silently dropping in-window releases, and count only accepted errors in `sentry_errors_per_hour`.

  The `GET /api/0/organizations/{organization}/releases/` list is ordered by `dateCreated` (date added) descending, while `dateReleased` is operator-set, nullable, and non-monotonic across pages. The incremental window now filters and short-circuits pagination on `dateCreated` only (and requests `sort=date` explicitly), so a page whose `dateReleased` values are out of `dateCreated` order no longer terminates pagination early or drops releases whose `dateCreated` is in-window. `dateReleased`/`lastEvent` are still stored as attributes.

  The `stats_v2` request for `sentry_errors_per_hour` now sets `outcome=accepted`. Without an outcome filter, `sum(quantity)` aggregates across every outcome (accepted, filtered, rate_limited, invalid, etc.) — total ingested volume rather than accepted (stored) errors — overcounting the intuitive error count.

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

- beb78ff: Require a `domain` field on connector vendor metadata, and give each connector a vendor domain.

  `connectorDocSchema` now requires `vendor.domain` (a validated hostname), so every connector declares the vendor's domain. This is a breaking change for connector authors using `@rawdash/core` directly. All built-in connectors now set `vendor.domain`.

- e47003f: Update the Sentry `error_stats` schema to tolerate the `stats_v2` response shape: `intervals` is now `.optional()`. Other observed drift (`groups[*].by.project`, `groups[*].totals["sum(quantity)"]`, `series`, `start`/`end`) is already permitted by the existing schema and needed no change.
- 80eccb6: Update the Sentry `issue_events` schema to match newly observed payloads: additional optional event-level fields (`crashFile`, `culprit`, `event.type`, `location`, `metadata`, `projectID`, `tags`, `title`, `user`).
- d224059: Update the Sentry `issues` schema to match newly observed payloads: richer `project` ref fields, ISO datetime validation for the seer/priority timestamps, a `project.id` that accepts string or number, and additional optional issue-level fields.
- c3d227f: Update the Sentry `releases` schema to match newly observed payloads: `dateReleased` and `lastEvent` became nullable/optional, plus additional optional fields on each release (`authors`, `commitCount`, `currentProjectMeta`, `data`, `deployCount`, `firstEvent`, `id`, `lastCommit`, `lastDeploy`, `newGroups`, `owner`, `ref`, `shortVersion`, `status`, `url`, `userAgent`, `versionInfo`) and on nested `projects` (`hasHealthData`, `id`, `name`, `newGroups`, `platform`, `platforms`).
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

- 66d2e20: Accelerate Sentry syncs. The per-issue event subrequests within an issues page — previously fetched one at a time and the dominant cost of the issues phase — now run with bounded concurrency (5 at a time). List page sizes honour the new `SyncOptions.pageSize` (clamped to Sentry's 100 max), and pagination pipelines page fetches with storage writes and yields a resumable cursor on a soft 25s per-chunk budget.
- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- 2c11cc2: Fix the `error_stats` resource crashing with `Cannot read properties of undefined (reading 'sum(quantity)')` when Sentry's `stats_v2` response contains a group without a populated `series` (common for low-activity orgs). The `series` field is now optional in both the response schema and TypeScript type, and `writeErrorStats` guards the access and skips groups with no series instead of throwing — so the crash no longer stalls the entire Sentry sync cursor and lets `issues` + `releases` land.
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

### Patch Changes

- a1c4c66: Extract shared connector boilerplate across six connectors. No behavior change for connector consumers; everything below is internal refactor.
  - `@rawdash/core` gains `makeChunkedCursorGuard(phases)`, `selectActivePhases(resourceToPhase, order, enabled)`, and `BaseConnector.isResourceEnabled<R>(resource)`. These replace hand-rolled copies that had accumulated across vercel/sentry/linear/stripe/github.
  - The internal `@rawdash/connector-shared` substrate gains `standardRateLimitPolicy({ remainingHeader, resetHeader, resetUnit, resetFallbackMs? })`, `sanitizeAllowedUrl({ url, host, pathname, protocol? })`, `parseEpoch(value, 'ms' | 's' | 'iso')`, and `connectorUserAgent(id)`. The vendor-named `githubRateLimit` / `sentryRateLimit` / `linearRateLimit` exports are gone — each connector now builds its policy from `standardRateLimitPolicy`, including vercel which previously rolled its own.
  - Property-test fetch-mock scaffolding (`mockResponse`, `installFetchMock`, `entityStoreFor`, `eventStoreFor`, `metricStoreFor`) was duplicated byte-for-byte in every connector's `property.test.ts`; it now lives in `@rawdash/connector-test-utils`.

  Net effect for downstream packages: identical behavior, ~200 fewer lines per connector, one place to fix when the substrate evolves.

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

- 2482b42: Add `@rawdash/connector-sentry` — Sentry connector covering issues (entities), sampled per-issue events, releases (entities), and hourly error-rate metrics. Authenticates with a Sentry Internal Integration or User Auth Token; supports project-scoped sync, per-issue event sampling caps, and incremental syncs filtered by `lastSeen`.

### Patch Changes

- Updated dependencies [8e217a5]
- Updated dependencies [6912896]
  - @rawdash/core@0.14.0
