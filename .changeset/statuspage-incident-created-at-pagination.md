---
'@rawdash/connector-statuspage': patch
---

Fix incident pagination to match the Statuspage incidents list's real ordering. The `GET /v1/pages/{page_id}/incidents` collection is sorted newest-first by `created_at` and exposes no `updated_at` sort or filter, but the connector short-circuited pagination (and windowed incidents) on `updated_at`. On incremental syncs this stopped after the first page whose oldest-_created_ incident had not changed since the last sync, silently dropping post-creation updates — resolutions, postmortems, reopens, and their `incident_update` events — for any incident beyond the newest ~100 by creation date.

The lookback window is now a `created_at` window: pagination short-circuits on `created_at` against the floor (the true sort key, so the stop is monotonic), the full window is re-scanned on every sync and incidents are upserted by id so state changes are always recaptured, and `options.since` is used only to deduplicate emitted `incident_update` events. The incidents request also now sends the endpoint's real page-size parameter `limit` (components continues to use `per_page`).
