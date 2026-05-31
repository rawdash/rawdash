# @rawdash/connector-hubspot

## 0.17.0

### Patch Changes

- @rawdash/core@0.17.0

## 0.16.0

### Minor Changes

- b62a21d: Add `@rawdash/connector-hubspot` — syncs HubSpot CRM contacts, companies, and deals (as entities), deal stage-change events (from deal property history), and marketing email campaigns + per-campaign stats into the six-shape storage model. Authenticates with a private app access token. Backfills and incrementally syncs CRM objects via the Search API (`hs_lastmodifieddate` filter + `after` cursor), and serves `count(...)` widgets directly from the Search API `total` so stat widgets don't force a full backfill.
- c27c332: Remove the connector-level `aggregate()` query fast-path; connectors are now pure resource syncers and the engine owns all query-time aggregation.

  `Connector` no longer exposes `aggregate()` or `validateCountFilter()`, and the `AggregateRequest` / `AggregateValue` types, `classifyWidget`, `readAggregate`, and `writeAggregate` are removed from `@rawdash/core`. During sync the runner no longer dispatches `connector.aggregate()`, writes `__widget_aggregate` rows, or drops resources from the entity-sync allowlist — every in-scope resource is entity-synced and `resolveWidget` always evaluates the metric via `computeMetric` over synced rows.

  The `github` and `hubspot` connectors drop their `aggregate()` / `validateCountFilter()` implementations. Correctness is unchanged; this only trades extra sync volume for a uniform, decoupled contract. Widget-level aggregation (`defineMetric({ fn: 'count', ... })` → `computeMetric`) and natively metric-shaped sources (CloudWatch, Cost Explorer, Google Analytics) are unaffected.

### Patch Changes

- Updated dependencies [422b711]
- Updated dependencies [79fdd64]
- Updated dependencies [a1c4c66]
- Updated dependencies [074ec25]
- Updated dependencies [022cbf1]
- Updated dependencies [e104540]
- Updated dependencies [9169ceb]
- Updated dependencies [5026a5b]
- Updated dependencies [c27c332]
- Updated dependencies [e8b014a]
- Updated dependencies [7060534]
- Updated dependencies [d52a6a8]
- Updated dependencies [d17a523]
  - @rawdash/core@0.16.0
