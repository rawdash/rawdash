# @rawdash/connector-mailgun

## 0.30.0

### Patch Changes

- Updated dependencies [5391ee0]
- Updated dependencies [88fac2d]
- Updated dependencies [351e604]
  - @rawdash/core@0.30.0

## 0.29.2

### Patch Changes

- Updated dependencies [5761126]
- Updated dependencies [88c2d08]
- Updated dependencies [58a1086]
- Updated dependencies [322664c]
- Updated dependencies [f0a1c55]
- Updated dependencies [8106c27]
- Updated dependencies [1aba313]
  - @rawdash/core@0.29.2

## 0.29.1

### Patch Changes

- Updated dependencies [d83f3eb]
  - @rawdash/core@0.29.1

## 0.29.0

### Patch Changes

- Updated dependencies [48283df]
- Updated dependencies [8eb995a]
  - @rawdash/core@0.29.0

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2

## 0.28.1

### Patch Changes

- 4d0d632: Add a Mailgun connector that syncs daily transactional email metrics (accepted, delivered, failed, opens, clicks, unsubscribes, complaints) via the Analytics Metrics API and a bounded sample of recent delivery events via the Analytics Logs API. Supports US and EU regions, HTTP basic auth with an API key, backfill plus incremental sync, and per-domain filtering. Incremental metric syncs replace only the refreshed window so older history is preserved.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1
