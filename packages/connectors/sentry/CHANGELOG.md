# @rawdash/connector-sentry

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
