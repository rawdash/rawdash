# @rawdash/connector-vercel

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

- beb78ff: Require a `domain` field on connector vendor metadata, and give each connector a vendor domain.

  `connectorDocSchema` now requires `vendor.domain` (a validated hostname), so every connector declares the vendor's domain. This is a breaking change for connector authors using `@rawdash/core` directly. All built-in connectors now set `vendor.domain`.

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

- 31adc7d: Add `@rawdash/connector-vercel` — syncs Vercel projects, deployments, and deployment state-transition events into the six-shape storage model. Authenticates with a Vercel access token (optionally scoped to a `teamId`). Backfills with cursor pagination over `/v9/projects` and `/v6/deployments`, then runs incremental sync via the `since` query param. Pairs with `@rawdash/connector-github` for "is this deploy healthy" widgets.

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
