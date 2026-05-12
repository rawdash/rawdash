# @rawdash/core

## 0.1.1

### Patch Changes

- 12f27e0: Bug fixes:
  - `@rawdash/cli` `--version` now reports the real package version instead of `0.0.0` ([RAW-123](https://linear.app/rawdash/issue/RAW-123)).
  - `rawdash deploy` now translates the OSS `defineConfig()` shape to the cloud's `POST /config` body shape, so deploys actually persist ([RAW-134](https://linear.app/rawdash/issue/RAW-134)).
  - `BaseConnector` gains a default `serializeConfig()` implementation; custom connectors extending `BaseConnector` inherit it transparently.

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
