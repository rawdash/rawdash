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

Widget IDs served by `GET /widgets` and `GET /widgets/:id` are now namespaced as `dashboardKey:widgetKey` (e.g. `github:run_count`).
