---
'@rawdash/connector-aws-cost': patch
---

Fix the resource allowlist gating so scoped syncs produce data. `sync()` compared the runner's `options.resources` allowlist (keyed by the stored resource names `aws_cost_daily` / `aws_cost_forecast`) against the internal phase names (`daily_cost` / `forecast`), so any non-empty allowlist matched nothing and both phases were skipped — the sync wrote nothing. A `PHASE_RESOURCES` map now translates each phase to its resource name before the check. Also classify `LimitExceededException` (Cost Explorer's HTTP 400 throttle) as a `RateLimitError` so it is retried with backoff instead of surfacing as a generic error.
