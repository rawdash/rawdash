---
'@rawdash/connector-github': minor
'@rawdash/core': minor
---

GitHub connector: gate N+1 reviews/statuses sub-fetches on a resource allowlist.

Adds an optional `resources?: ReadonlyArray<string>` field to `SyncOptions`. When set, the GitHub connector skips the per-PR `GET /pulls/{n}/reviews` fan-out unless `pull_request_reviews` is in the allowlist, and skips the per-deployment `GET /deployments/{id}/statuses` fan-out unless `deployment_statuses` is in the allowlist. When `resources` is unset, behavior is unchanged — both sub-resources are still fetched.

This eliminates the dominant source of wasted API calls when a dashboard only needs PR / deployment counts. Combined with the existing `since`-aware page filtering (sub-fetches already only run for survivors of the cutoff), real-world repos like `rawdash/rawdash` no longer blow past the 5-min sync budget on the example dashboard.

The runner that actually computes and passes the allowlist is wired up separately.
