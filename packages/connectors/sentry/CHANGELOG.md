# @rawdash/connector-sentry

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
