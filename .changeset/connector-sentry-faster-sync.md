---
'@rawdash/connector-sentry': patch
---

Accelerate Sentry syncs. The per-issue event subrequests within an issues page — previously fetched one at a time and the dominant cost of the issues phase — now run with bounded concurrency (5 at a time). List page sizes honour the new `SyncOptions.pageSize` (clamped to Sentry's 100 max), and pagination pipelines page fetches with storage writes and yields a resumable cursor on a soft 25s per-chunk budget.
