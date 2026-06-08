---
'@rawdash/core': patch
---

Speed up high-volume connector syncs from `@rawdash/core`. `SyncOptions` gains an optional `pageSize` so the page size can be tuned at sync time (e.g. from the cloud `toOssSyncOptions`) without a connector release. `paginateChunked` gains two opt-in options: `maxChunkMs`, a soft per-chunk wall-clock budget that yields a resumable cursor once exceeded so a long phase is checkpointed across queue round-trips instead of one marathon invocation; and `pipeline`, which overlaps the fetch of the next page with the write of the current one (exactly one fetch and one write in flight at a time, preserving rate limits and write ordering). Both default off, so existing callers are unaffected.
