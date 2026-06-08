# @rawdash/connector-greenhouse

## 0.21.1

### Patch Changes

- @rawdash/core@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Minor Changes

- 055d978: Add `@rawdash/connector-greenhouse` — syncs Greenhouse Harvest data into the six-shape storage model: jobs, candidates, applications, and offers as entities (with department/office, current stage, source, status, and the timestamps that drive funnel widgets), plus application lifecycle events (`applied` / `hired` / `rejected`) derived from each application's built-in timestamps. Authenticates via HTTP Basic with a single Harvest API key as the username (no per-resource token rotation), follows the RFC 5988 `Link: rel="next"` header for pagination, and threads `options.since` through as the `updated_after` filter on every paginated phase so incremental ticks stay cheap under the 50 req / 10 s key quota. A new `hr` connector category is added to `@rawdash/core` so this and future HR / ATS connectors land in a dedicated docs vertical.

### Patch Changes

- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0
