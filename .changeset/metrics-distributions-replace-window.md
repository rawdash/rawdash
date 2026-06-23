---
'@rawdash/core': patch
'@rawdash/adapter-libsql': patch
'@rawdash/adapter-sqlite': patch
---

Add an optional `replaceWindow` to `StorageHandle.metrics()` and `StorageHandle.distributions()`. When provided (`{ start, end }`, inclusive on both bounds), only rows for the scoped names whose `ts` falls inside the window are deleted before the new samples are inserted, instead of replacing the full history for those names. Omitting `replaceWindow` keeps the existing full delete-by-name behavior, so this is fully backward compatible. This lets connectors that re-pull only a partial window refresh just that window without wiping previously retained history.
