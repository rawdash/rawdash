---
'@rawdash/core': minor
'@rawdash/sdk-client': minor
'@rawdash/sdk-nextjs': minor
'@rawdash/server': minor
'@rawdash/mcp': minor
---

Widgets can now combine data from multiple connectors. A widget's `metric` accepts either a single `ComputedMetric` (unchanged) or an array of metrics — one per connector — each with its own `name`/`field`/`fn`. Resolved widgets expose a per-connector `series[]` on `CachedWidget`, and `StatusWidget.source` accepts a list of connectors for a combined worst-of health badge.

An optional `aggregate: { fn }` on a widget merges the per-connector series server-side into the top-level `data`. The same merge is available client-side via the new `mergeSeries` / `mergeSeriesScalar` helpers (exported from `@rawdash/core`, `@rawdash/sdk-client`, and `@rawdash/sdk-nextjs`).

Single-connector widgets are unchanged on the wire. The `metric` and `source` config types widen to unions, which is a type-level breaking change for code that introspects widget configs.
