---
'@rawdash/core': minor
'@rawdash/server': patch
'@rawdash/connector-github': patch
---

Scope OSS sync to widget-referenced resources, not just connectors.

`computeConnectorBackfill` now returns per-resource scope (`Map<connectorName, Map<resourceName, { requiredWindowMs }>>`) so the runner knows which resources each widget actually references. **Breaking** for direct consumers of `computeConnectorBackfill`: the return shape gained an inner `Map<resourceName, ResourceBackfill>` layer where it previously held a single `ConnectorBackfill` per connector. Status widgets register their connector with an empty inner map.

`SyncOptions` gains an optional `resources?: ReadonlySet<string>` allowlist. `runSync` derives it (plus the max window across resources) from the per-resource scope and threads it into every `connector.sync` call. Connectors that don't read the option keep their current behavior.

The GitHub connector now gates its phases on the allowlist via a `PHASE_RESOURCES` map — dashboards that don't reference `deployment`, `release`, or `contributor` no longer page through `/deployments`, `/deployment_statuses`, `/releases`, or `/stats/contributors`. An empty allowlist (status-only configs) short-circuits to `done: true` so the sync run still completes for connector-health tracking without hitting upstream.
