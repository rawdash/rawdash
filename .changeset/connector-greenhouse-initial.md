---
'@rawdash/connector-greenhouse': minor
'@rawdash/core': patch
---

Add `@rawdash/connector-greenhouse` — syncs Greenhouse Harvest data into the six-shape storage model: jobs, candidates, applications, and offers as entities (with department/office, current stage, source, status, and the timestamps that drive funnel widgets), plus application lifecycle events (`applied` / `hired` / `rejected`) derived from each application's built-in timestamps. Authenticates via HTTP Basic with a single Harvest API key as the username (no per-resource token rotation), follows the RFC 5988 `Link: rel="next"` header for pagination, and threads `options.since` through as the `updated_after` filter on every paginated phase so incremental ticks stay cheap under the 50 req / 10 s key quota. A new `hr` connector category is added to `@rawdash/core` so this and future HR / ATS connectors land in a dedicated docs vertical.
