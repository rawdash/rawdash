---
'@rawdash/connector-gitlab': patch
---

Fix the pipelines sync emitting duplicate `pipeline_event` rows for a single unique pipeline id. Pipeline entities collapse to one row per `(project, pipeline id)` via last-write-wins, but events were appended unconditionally inside the loop, so a page containing duplicate pipeline ids produced multiple events. Events are now deduped by `(project, pipeline id)` (last occurrence wins) to match entity semantics.
