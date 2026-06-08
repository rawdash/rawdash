# @rawdash/connector-intercom

## 0.20.0

### Patch Changes

- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0

## 0.17.0

### Minor Changes

- 4481cef: Add `@rawdash/connector-intercom` — syncs Intercom support data into the six-shape storage model: admins, teams, and contacts as entities; conversations as entities (state, priority, assignment, statistics rollups, tag names); and conversation state transitions (`created` / `assigned` / `closed` / `snoozed`) as events derived from each conversation's `statistics` block. Authenticates with a single access token (personal or app), and routes requests to the matching region host (`us` / `eu` / `au`). Backfills paginate `POST /conversations/search` and `POST /contacts/search` via the API's `starting_after` cursor; incremental syncs add a Unix-seconds `updated_at > since` query filter so only changed records are streamed.

### Patch Changes

- @rawdash/core@0.17.0
