# @rawdash/core

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
