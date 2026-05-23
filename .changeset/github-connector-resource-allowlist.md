---
'@rawdash/core': patch
'@rawdash/connector-github': patch
---

GitHub connector: eliminate N+1 reviews/statuses fetches when widgets don't need them.

`SyncOptions` gains an optional `resources?: ReadonlySet<string>` allowlist. When provided, the GitHub connector skips its per-PR `/pulls/{n}/reviews` fan-out unless `pull_request_reviews` is in the set, and skips its per-deployment `/deployments/{id}/statuses` fan-out unless `deployment_statuses` is in the set. Sub-fetches were already gated on `since` (so old PRs/deployments don't cost a review/status call), and the PR page loop already short-circuits once the last PR on a page is older than `since`. Together these mean dashboards that only need PR counts no longer pay for hundreds of `/reviews` calls per page.

Backward compatible: when `resources` is undefined the connector fetches everything as before.
