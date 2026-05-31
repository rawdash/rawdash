---
'@rawdash/connector-intercom': minor
---

Add `@rawdash/connector-intercom` — syncs Intercom support data into the six-shape storage model: admins, teams, and contacts as entities; conversations as entities (state, priority, assignment, statistics rollups, tag names); and conversation state transitions (`created` / `assigned` / `closed` / `snoozed`) as events derived from each conversation's `statistics` block. Authenticates with a single access token (personal or app), and routes requests to the matching region host (`us` / `eu` / `au`). Backfills paginate `POST /conversations/search` and `POST /contacts/search` via the API's `starting_after` cursor; incremental syncs add a Unix-seconds `updated_at > since` query filter so only changed records are streamed.
