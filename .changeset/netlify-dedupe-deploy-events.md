---
'@rawdash/connector-netlify': patch
---

Fix the deploys sync emitting duplicate `netlify_deploy_event` rows for a single unique deploy id. Deploy entities collapse to one row per `(site, deploy id)` via last-write-wins, but events were appended unconditionally inside the loop, so a page containing duplicate deploy ids produced multiple events. Events are now deduped by `(site, deploy id)` (last occurrence wins) to match entity semantics.
