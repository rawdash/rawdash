---
'@rawdash/connector-github': patch
---

Fix incremental-sync data loss in list endpoints GitHub does not contractually order, and drop an invalid pull-request `state` filter value.

- `workflow_run`: workflow runs mutate after creation (a re-run changes `status`/`conclusion` for up to ~30 days), and `GET /actions/runs` is ordered by `created_at` descending with no `updated`-since filter, so an old run that was re-run recently sits deep in the list. The early-exit now pages back by a ~32-day re-run look-back (stops only when `created_at < cutoff - 32d`) while still admitting any run whose `updated_at` is within the window, so recently re-run runs are no longer dropped on incremental syncs.
- `release`: `GET /releases` order is not guaranteed, so short-circuiting/filtering on `published_at ?? created_at` could terminate early and drop in-window releases (e.g. a long-lived draft published recently). Now filters client-side on `created_at` only and pages to the end of the window; `published_at` is still stored as an attribute.
- `deployment`: `GET /deployments` does not document a `created_at` ordering and deployments churn status, so the `created_at` early-break could drop in-window rows. Now pages fully within the window and relies on the client-side filter.
- `pull_request`: removed the invalid `merged` value from the declared `state` filter — `GET /pulls` `state` only accepts `open`, `closed`, or `all` (merged PRs are `closed` with `merged_at` set), so a `state == merged` filter was silently ignored.
- `issue`: pin `sort=updated&direction=asc` for deterministic ordering (the `since` filter already bounds the set).
