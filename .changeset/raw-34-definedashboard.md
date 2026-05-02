---
'@rawdash/core': major
'@rawdash/server': major
---

**Breaking change**: `defineConfig()` no longer accepts a flat `widgets` map. Widgets are now grouped under named dashboards via `defineDashboard()`.

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
