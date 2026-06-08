# @rawdash/connector-zendesk

## 0.20.0

### Patch Changes

- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0

## 0.19.0

### Minor Changes

- 336dc03: Add `@rawdash/connector-zendesk` — syncs Zendesk Support data into the six-shape storage model: users and groups as entities; tickets as entities (status, priority, channel, assignment, tags, per-ticket CSAT score); ticket state transitions (`created` / `solved`) as events derived from each ticket's timestamps; and per-ticket satisfaction ratings as entities. Authenticates over HTTP Basic auth with an agent email plus an API token, routing requests to the account subdomain (`<subdomain>.zendesk.com`). Backfills paginate `GET /api/v2/incremental/tickets/cursor.json` via the API's cursor field and `GET /api/v2/users.json` / `groups.json` / `satisfaction_ratings.json` via `page[after]` cursors; incremental syncs pass `start_time` (Unix seconds) on the first page so only changed records are streamed.

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0
