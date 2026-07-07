---
'@rawdash/connector-netlify': patch
---

Honor the per-sync resource scope by resource-type name. The connector previously selected phases and gated all writes (and the full-sync "clear then replace" step) using only its persisted `resources` config, ignoring the resource scope requested on each individual sync. A sync scoped to a subset of resources now skips fetching, writing, and clearing the resource types it did not ask for; an empty/absent scope keeps syncing everything the config enables.

Also expand the advertised `netlify_deploy` `state` filter to the full set of values the deploys endpoint accepts (`new`, `pending_review`, `accepted`, `rejected`, `enqueued`, `building`, `uploading`, `uploaded`, `preparing`, `prepared`, `processing`, `processed`, `ready`, `error`, `retrying`).
