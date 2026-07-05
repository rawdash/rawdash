# @rawdash/connector-bill

## 0.30.0

### Patch Changes

- Updated dependencies [5391ee0]
- Updated dependencies [88fac2d]
- Updated dependencies [351e604]
  - @rawdash/core@0.30.0

## 0.29.2

### Patch Changes

- 9786fbf: Add a BILL (Bill.com) connector that syncs accounts-payable bills, vendors, and vendor payments via the BILL v3 API. Signs in with a developer key, username, password, and organization ID to obtain a session, then paginates each resource with cursor-based `nextPage` navigation. Supports backfill plus incremental sync (filtering on `updatedTime` so status transitions are re-fetched) and per-resource selection. Bills and vendors are stored as entities; payments as events timestamped at their process date.
- Updated dependencies [5761126]
- Updated dependencies [88c2d08]
- Updated dependencies [58a1086]
- Updated dependencies [322664c]
- Updated dependencies [f0a1c55]
- Updated dependencies [8106c27]
- Updated dependencies [1aba313]
  - @rawdash/core@0.29.2
