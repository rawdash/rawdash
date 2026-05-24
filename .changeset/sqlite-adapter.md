---
'@rawdash/adapter-sqlite': minor
---

New `@rawdash/adapter-sqlite` package — file-backed SQLite `ServerStorage` for
local OSS development. Thin wrapper over `@rawdash/adapter-libsql` that points
libSQL at a local file (creates the parent directory automatically). Default
storage in the example-nextjs dev server — survives restarts, no more cold
syncs on every file change. Set `RAWDASH_STORAGE=memory` to opt back into
in-memory storage.
