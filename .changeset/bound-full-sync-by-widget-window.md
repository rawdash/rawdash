---
'@rawdash/core': patch
'@rawdash/connector-github': patch
---

Bound full-sync fetch volume by the widget-declared window. `SyncOptions` gains an optional `requiredWindowMs` map (keyed by resource) and a new `resolveBackfillCutoff` helper merges it with `since` into a single lower bound. The GitHub connector now honors this window when paginating `workflow_runs`, `pull_requests`, `issues`, `deployments`, and `releases`, so an initial sync only pulls as much history as the dashboard's widgets require. A windowless widget still triggers an unbounded fetch, and behavior is unchanged when no window is supplied.
