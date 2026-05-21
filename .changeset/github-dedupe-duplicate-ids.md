---
'@rawdash/connector-github': patch
---

Fix silent overwrite on duplicate ids in the GitHub connector. The API can legitimately return the same item twice within a single sync (pagination overlap on mutating collections, retried requests, cross-endpoint overlap). Each resource (`workflow_runs`, `pull_requests`, `issues`, `deployments`, `releases`, `contributors`) now dedupes by stable id before writing, using a keep-last strategy, and logs a `console.warn` when duplicates are dropped so the behavior is observable.
