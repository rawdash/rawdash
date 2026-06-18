---
'@rawdash/core': minor
---

Enforce the metric-shape contract so a widget `field` is portable across connectors. Metric resources may now declare `measures` (secondary numerics carried in `attributes`) alongside `dimensions`; the primary numeric always lives in `value` and must never be mirrored into an attribute. `defineResources` rejects metric dimensions/measures named `value`, `name`, or `ts`, and duplicate field names. Metric `field` validation now runs even when a metric declares no dimensions — a `field` that isn't `value`, a declared dimension, or a declared measure is rejected (closing the silent-zero gap where `field: 'count'` summed a missing attribute to `0`).

Adds a producer-side enforcement helper: `metricSample(resources, name, { ts, value, attributes })` types `attributes` to the named resource's declared dimensions/measures so an undeclared key (or a mirrored value) fails to typecheck.
