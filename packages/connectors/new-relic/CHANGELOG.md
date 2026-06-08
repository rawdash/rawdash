# @rawdash/connector-new-relic

## 0.21.1

### Patch Changes

- @rawdash/core@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Patch Changes

- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0

## 0.19.0

### Minor Changes

- 33d5b1c: Add `@rawdash/connector-new-relic` — syncs New Relic observability data into the six-shape storage model: NRQL alert conditions as entities (id, name, enabled, policyId, type, underlying NRQL); AI alert violations as events derived from the `NrAiIncident` event type with `openedAt` / `closedAt` and the originating condition / policy metadata; and user-declared NRQL queries as dynamic metric samples stored under `newrelic_nrql_metric.<query name>`. Authenticates with a User API key and a numeric account ID, routes every resource through a single NerdGraph GraphQL endpoint, and supports both the US (`api.newrelic.com`) and EU (`api.eu.newrelic.com`) regions. Backfills paginate `nrqlConditionsSearch` via NerdGraph cursors; incremental syncs push `options.since` into the incidents NRQL `openedAt` filter and auto-append `SINCE <lookback>` to user queries that do not declare their own clause.

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0
