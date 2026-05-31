# @rawdash/connector-mixpanel

## 0.17.0

### Patch Changes

- @rawdash/core@0.17.0

## 0.16.0

### Minor Changes

- ab6b5c2: Add `@rawdash/connector-mixpanel` — a Mixpanel connector that syncs DAU/WAU/MAU, per-event volume, declared funnel conversion data, and cohort retention into the six-shape storage model via the Mixpanel Query API. Authenticates with a project-scoped service account (HTTP Basic) and supports both US and EU data regions. Backfill (90-day default) and incremental (3-day rolling) sync modes are both supported, with phase-level resumable cursors and `options.resources` allowlist support so dashboards that only need a subset of resources don't pay for the others.

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
