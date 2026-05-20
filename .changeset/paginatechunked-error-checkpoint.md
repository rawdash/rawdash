---
'@rawdash/core': minor
---

`paginateChunked` now checkpoints on caught fetch errors. When `fetchPage` throws, the helper returns `{ done: false, cursor, transientError }` so the host can re-enqueue from the advanced cursor instead of restarting at the inbound cursor. `SyncResult` gains an optional `transientError?: unknown` field that surfaces the underlying error for host-side retry decisions.
