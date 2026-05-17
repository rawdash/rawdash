# @rawdash/adapter-turso

## 0.3.0

### Patch Changes

- 2ca8591: Bump `@libsql/client` dependency from `^0.14.0` to `^0.17.0` to track the current stable line.
- Updated dependencies [c70db8d]
- Updated dependencies [13744df]
- Updated dependencies [2ca8591]
  - @rawdash/core@0.3.0

## 0.2.0

### Patch Changes

- 725ea8a: Extract the widget engine into a runtime-neutral module in `@rawdash/core`.
  - `computeMetric`, `resolveWidget`, `InMemoryStorage`, and the `ServerStorage` interface now live in `@rawdash/core` and are re-exported from `@rawdash/server` for back-compat.
  - New `@rawdash/core/libsql` subpath export ships a `LibsqlStorage` adapter built on `@libsql/client/web` — runtime-neutral and Worker-compatible (no Node APIs, no drizzle migrator).
  - `widgetSchemas` (and new `widgetSchema`, `resolvedMetricSchema`, `filterClauseSchema`, `groupBySchema`, etc.) now describe the actual rich `Widget` discriminated union instead of using a placeholder `metric: z.string()`.

- Updated dependencies [725ea8a]
  - @rawdash/core@0.2.0

## 0.1.0

### Patch Changes

- Updated dependencies [0f069f7]
  - @rawdash/core@0.1.0
  - @rawdash/server@0.1.0
