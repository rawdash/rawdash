---
'@rawdash/connector-posthog': patch
---

Accelerate PostHog syncs. Pagination now pipelines page fetches with storage writes and yields a resumable cursor on a soft 25s per-chunk budget. The feature-flags page size honours the new `SyncOptions.pageSize` (clamped to a safe ceiling).
