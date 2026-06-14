---
'@rawdash/connector-branch': minor
---

Fix the Branch connector so it returns correct, complete data against the live Branch Query API (`POST /v1/query/analytics`). Previously every value was 0, every timestamp invalid, and most syncs failed outright; the tests passed only because they mocked the inverted shape.

- Correct the response schema nesting. Branch returns `{ "timestamp": "<iso>", "result": { "<dimension>": ..., "unique_count": <n> } }` — `timestamp` at the item top level and `unique_count` nested inside `result`. The connector had these inverted, so `unique_count` was always `undefined` (every metric/event read as 0) and `timestamp` was always `undefined` (every sample timestamped at 0). The schemas and all read sites now match the documented shape.
- Split each requested window into `<=7`-day segments. Branch rejects ranges where `end_date` is more than 7 days after `start_date`; the connector issued a single 90-day (full) or 14-day (incremental) call, so the request was rejected and the sync failed. Each phase now fetches one segment at a time and accumulates the results.
- Replace the invalid `eo_event` data source with `eo_custom_event` for the "conversions" metric. Branch has no `eo_event` source, so the conversions call errored or returned empty. Commerce conversions (`eo_commerce_event`) are a documented follow-up.
- Paginate the Query API. `fetchAggregate` now follows `paging.next_url` until exhausted (requesting `limit: 1000` per page) instead of silently keeping only the first 100 rows; `paging` was added to the response schema.
- **Breaking:** drop the `costEstimated` dimension from `branch_install_metrics`. `cost_in_local_currency` is only returned when requested as an aggregation, so with `aggregation: unique_count` it was always 0. The always-zero field and its misleading limitation note are removed; a dedicated cost-aggregation call is a documented follow-up.
- Correct the rate-limit documentation (5/s, 20/min, 150/hour) and note that the `<=7`-day chunking plus pagination fan out to many requests, relying on the shared HTTP client's 429 + `Retry-After` backoff.
