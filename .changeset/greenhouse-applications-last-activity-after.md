---
'@rawdash/connector-greenhouse': patch
---

Fix Greenhouse applications incremental sync sending an unsupported `updated_after` filter. `GET /v1/applications` does not accept `updated_after` (its incremental filter is `last_activity_after`), so Greenhouse ignored the parameter and every incremental sync re-scanned the entire applications collection. The `applications` phase now sends `last_activity_after`; `jobs`, `candidates`, and `offers` continue to use the `updated_after` they support.
