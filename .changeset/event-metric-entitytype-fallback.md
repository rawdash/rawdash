---
'@rawdash/core': minor
---

Fix event/metric/distribution metrics silently computing 0 when keyed by `entityType` instead of `name` (RAW-534). Previously only the `entity` branch fell back from `entityType` to `name`; the `event`, `metric`, and `distribution` branches read `metric.name` only, so a schema-valid metric that set `entityType` (e.g. a `workflow_runs` event metric with `entityType: 'workflow_run'`) queried with `name: undefined` and returned 0 despite ingested data. All name-keyed shapes now fall back to `metric.name ?? metric.entityType`, restoring symmetry with the entity branch. Additionally, `computedMetricSchema` now requires at least one of `name`/`entityType`, so a metric that identifies no data fails loudly at deploy/validate time instead of rendering 0.
