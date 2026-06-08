---
'@rawdash/connector-shared': patch
---

Add `mapWithConcurrency(items, concurrency, fn)`, a bounded-parallelism helper that maps over items with at most N calls in flight, preserves input order, and propagates the first rejection (halting new work). Useful for overlapping the slow per-item subrequests some connectors make within a single page.
