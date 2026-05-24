---
'@rawdash/core': minor
'@rawdash/server': patch
'@rawdash/connector-github': patch
---

Connectors can now expose `count()` / `latest()` aggregate operations and the runner calls them directly instead of paginating entities for single-scalar stat widgets.

`Connector` gains an optional `aggregate(req, signal)` method. Core ships `classifyWidget(widget)` to bucket each widget into `{ via: 'aggregate' | 'entity-sync' }` — aggregate-eligible widgets are plain `stat` widgets whose `fn` is `count` or `latest` with no `window`, no `groupBy`, and (for `latest`) a `field`. `runSync` now:

1. Walks every widget targeting the connector, runs `connector.aggregate(...)` in parallel for the aggregate-eligible ones, and stores the scalar under an `__widget_aggregate` entity (`getEntity(AGGREGATE_ENTITY_TYPE, widgetId)`).
2. Drops a resource from the entity-sync allowlist only when every widget using it is aggregate-served. When the resulting allowlist is empty the entity-sync pass is skipped entirely.
3. `resolveWidget` reads the cached aggregate scalar first for aggregate-eligible widgets, falling back to `computeMetric` when no scalar has been written yet.

The GitHub connector implements `aggregate` against efficient REST endpoints: `/repos/X` for `repo` stars/forks/watchers, `/search/issues` (`total_count`) for `pull_request` / `issue` counts, `/repos/X/contributors?per_page=1` for the contributor count (parsed from the `Link` header), and `/repos/X/actions/runs?per_page=1` for the latest `workflow_run`. For the `example-nextjs` dashboard, a cold-start sync collapses from ~600 paginated requests to ~7 single requests.

`FilterClause` / `FilterCondition` / `FilterOperator` moved to a dedicated `filters.ts` module and are re-exported from both `config` and the package root — no source change for consumers.
