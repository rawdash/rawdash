---
'@rawdash/core': minor
---

`paginateChunked` now defaults `maxChunkMs` to `DEFAULT_MAX_CHUNK_MS` (30s) when omitted, so every connector's `sync()` returns a graceful, resumable chunk boundary on a wall-time budget instead of paginating an entire resource in a single call. Heavy connectors (e.g. github-actions) now complete a sync as a series of short, bounded chunks rather than relying on the caller's `AbortSignal`. Low-volume connectors are unaffected — they still finish in one chunk. Callers that want unbounded pagination can pass `maxChunkMs: Infinity`.
