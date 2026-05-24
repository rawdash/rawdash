---
'@rawdash/connector-github': minor
'@rawdash/core': minor
---

GitHub connector: extend `aggregate()` with `latest(release, field)`, richer count filters, structured INFO logs, and a new `validateCountFilter` hook.

- `latest(release, field)` now hits `GET /repos/O/R/releases/latest` and returns `tag_name`, `name`, `author`, or `published_at` in a single API call (previously fell back to entity-sync over `/releases?per_page=100`).
- Count filter translation now supports `state`, `label`, `author`, `assignee`, `milestone`, `draft`, `head`, and `base` — mapped to the matching `is:` / `label:` / `author:` etc. GitHub Search qualifiers. Unsupported operators (anything other than `eq`) and unknown fields are rejected with a descriptive error.
- `count(repo)` and `count(workflow_run)` are now rejected explicitly rather than silently routed to the `latest` code path.
- Each aggregate call emits a structured `info` log (`[github-actions] aggregate fn=count resource=pull_request query="repo:o/r is:pr is:open" value=194 via="search API"`) — one line per aggregate, matching the cadence introduced by the progress-log work.

Core: `Connector` gains an optional `validateCountFilter(resource, filter)` hook so config-time validation can reject unsupported filter combinations before the first sync. The GitHub connector implements it by re-using its runtime translation table.
