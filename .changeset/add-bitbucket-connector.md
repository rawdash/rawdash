---
'@rawdash/connector-bitbucket': minor
---

Add `@rawdash/connector-bitbucket` — sync Bitbucket Cloud pull requests, pipelines, and pipeline lifecycle events. Authenticates via an Atlassian username + Bitbucket app password (Basic auth). Configure one or more repository slugs per workspace; pagination is body-based via the `next` URL and incremental syncs filter on `updated_on`/`created_on` via the BBQL `q=` parameter.
