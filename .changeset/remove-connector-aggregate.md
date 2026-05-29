---
'@rawdash/core': minor
'@rawdash/connector-github': minor
'@rawdash/connector-hubspot': minor
'@rawdash/server': patch
---

Remove the connector-level `aggregate()` query fast-path; connectors are now pure resource syncers and the engine owns all query-time aggregation.

`Connector` no longer exposes `aggregate()` or `validateCountFilter()`, and the `AggregateRequest` / `AggregateValue` types, `classifyWidget`, `readAggregate`, and `writeAggregate` are removed from `@rawdash/core`. During sync the runner no longer dispatches `connector.aggregate()`, writes `__widget_aggregate` rows, or drops resources from the entity-sync allowlist — every in-scope resource is entity-synced and `resolveWidget` always evaluates the metric via `computeMetric` over synced rows.

The `github` and `hubspot` connectors drop their `aggregate()` / `validateCountFilter()` implementations. Correctness is unchanged; this only trades extra sync volume for a uniform, decoupled contract. Widget-level aggregation (`defineMetric({ fn: 'count', ... })` → `computeMetric`) and natively metric-shaped sources (CloudWatch, Cost Explorer, Google Analytics) are unaffected.
