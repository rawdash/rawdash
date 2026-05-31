# @rawdash/adapter-sqlite

## 0.16.0

### Minor Changes

- afb68a9: New `@rawdash/adapter-sqlite` package — file-backed SQLite `ServerStorage` for
  local OSS development. Thin wrapper over `@rawdash/adapter-libsql` that points
  libSQL at a local file (creates the parent directory automatically). Default
  storage in the example-nextjs dev server — survives restarts, no more cold
  syncs on every file change. Set `RAWDASH_STORAGE=memory` to opt back into
  in-memory storage.

### Patch Changes

- Updated dependencies [422b711]
- Updated dependencies [79fdd64]
- Updated dependencies [a1c4c66]
- Updated dependencies [074ec25]
- Updated dependencies [022cbf1]
- Updated dependencies [e104540]
- Updated dependencies [9169ceb]
- Updated dependencies [5026a5b]
- Updated dependencies [c27c332]
- Updated dependencies [e8b014a]
- Updated dependencies [7060534]
- Updated dependencies [d52a6a8]
- Updated dependencies [d17a523]
  - @rawdash/core@0.16.0
  - @rawdash/adapter-libsql@0.16.0
