---
'@rawdash/core': patch
---

`paginateChunked` now also checkpoints on caught `writeBatch` errors. Previously only `fetchPage` was wrapped, so write-side failures (e.g. libsql WebSocket calls tripping the Cloudflare subrequest cap) propagated out uncaught and the host could not advance the cursor. `writeBatch` is now wrapped symmetrically: on a non-abort error the helper returns `{ done: false, cursor: { phase, page }, transientError }` with the same page that failed to write, so the next chunk re-fetches and re-writes that page (writes are idempotent at the storage layer).
