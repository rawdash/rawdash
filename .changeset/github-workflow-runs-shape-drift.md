---
'@rawdash/connector-github': patch
---

Extend the `workflow_runs` Zod schema to accept newly-observed GitHub API fields (`artifacts_url`, `display_title`, `event`, `head_sha`, `html_url`, `run_number`, `run_started_at`, `triggering_actor`, `url`, `workflow_id`, etc., plus top-level `total_count`). All new fields are `.optional()` so older payloads still validate. Nullable type-changes on `conclusion`, `head_branch`, and `actor` are intentionally left as-is since existing sync code handles nulls defensively.
