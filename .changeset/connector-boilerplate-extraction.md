---
'@rawdash/core': patch
'@rawdash/connector-github': patch
'@rawdash/connector-google-analytics': patch
'@rawdash/connector-linear': patch
'@rawdash/connector-sentry': patch
'@rawdash/connector-stripe': patch
'@rawdash/connector-vercel': patch
---

Extract shared connector boilerplate across six connectors. No behavior change for connector consumers; everything below is internal refactor.

- `@rawdash/core` gains `makeChunkedCursorGuard(phases)`, `selectActivePhases(resourceToPhase, order, enabled)`, and `BaseConnector.isResourceEnabled<R>(resource)`. These replace hand-rolled copies that had accumulated across vercel/sentry/linear/stripe/github.

- The internal `@rawdash/connector-shared` substrate gains `standardRateLimitPolicy({ remainingHeader, resetHeader, resetUnit, resetFallbackMs? })`, `sanitizeAllowedUrl({ url, host, pathname, protocol? })`, `parseEpoch(value, 'ms' | 's' | 'iso')`, and `connectorUserAgent(id)`. The vendor-named `githubRateLimit` / `sentryRateLimit` / `linearRateLimit` exports are gone — each connector now builds its policy from `standardRateLimitPolicy`, including vercel which previously rolled its own.

- Property-test fetch-mock scaffolding (`mockResponse`, `installFetchMock`, `entityStoreFor`, `eventStoreFor`, `metricStoreFor`) was duplicated byte-for-byte in every connector's `property.test.ts`; it now lives in `@rawdash/connector-test-utils`.

Net effect for downstream packages: identical behavior, ~200 fewer lines per connector, one place to fix when the substrate evolves.
