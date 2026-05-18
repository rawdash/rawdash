---
'@rawdash/core': minor
'@rawdash/connector-github': minor
---

Extend the `Connector.sync` contract with resumable progress: `SyncOptions.cursor?: unknown` carries opaque resumption state from the host, and `sync()` now returns `SyncResult = { done: boolean; cursor?: unknown }` so chunked syncs can hand control back to the host between pages.

The github-actions connector now threads a `{ phase, pageUrl }` cursor through all paginated phases (workflow runs, pull requests, issues, deployments, releases) and checks `signal.aborted` at page boundaries. When the host signals a yield, the connector returns the in-progress phase + page URL instead of restarting from scratch on the next chunk — letting large GitHub backfills make forward progress under the cloud worker's subrequest budget.
