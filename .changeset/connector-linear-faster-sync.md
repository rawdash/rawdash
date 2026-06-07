---
'@rawdash/connector-linear': patch
---

Accelerate Linear syncs. Flat resources (teams/users/cycles) now page at 250 items (up from 50) and issues page at 150, cutting the number of round-trips several-fold. The issues page size is automatically capped against the nested per-issue history depth so larger pages don't trip Linear's GraphQL query-complexity limit, and the default `historyPerIssue` is lowered from 25 to 8 to keep the combined query cheap (still tunable, and incremental syncs append newer transitions across runs). Page sizes also honour the new `SyncOptions.pageSize` (clamped to Linear's 250 max). Pagination now pipelines page fetches with storage writes and yields a resumable cursor on a soft 25s per-chunk budget.
