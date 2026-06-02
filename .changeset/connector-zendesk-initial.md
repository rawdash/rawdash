---
'@rawdash/connector-zendesk': minor
---

Add `@rawdash/connector-zendesk` — syncs Zendesk Support data into the six-shape storage model: users and groups as entities; tickets as entities (status, priority, channel, assignment, tags, per-ticket CSAT score); ticket state transitions (`created` / `solved`) as events derived from each ticket's timestamps; and per-ticket satisfaction ratings as entities. Authenticates over HTTP Basic auth with an agent email plus an API token, routing requests to the account subdomain (`<subdomain>.zendesk.com`). Backfills paginate `GET /api/v2/incremental/tickets/cursor.json` via the API's cursor field and `GET /api/v2/users.json` / `groups.json` / `satisfaction_ratings.json` via `page[after]` cursors; incremental syncs pass `start_time` (Unix seconds) on the first page so only changed records are streamed.
