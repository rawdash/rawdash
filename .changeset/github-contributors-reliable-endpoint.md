---
'@rawdash/connector-github': minor
---

Fix the `contributor` resource returning zero. The connector now syncs contributors from `GET /repos/{owner}/{repo}/contributors` (paginated, immediate) instead of `GET /repos/{owner}/{repo}/stats/contributors`, which returns `202` while GitHub computes statistics asynchronously and frequently never became ready within the retry budget on a cold cache — leaving the `contributor` entity empty and the Contributors widget at 0. The `contributor` entity now carries a single `commits` attribute (from the endpoint's `contributions` count); the previously derived `additions`, `deletions`, and `latest_commit_at` attributes (sourced from the weekly stats payload) are no longer emitted. The flaky `202` retry-and-skip path is removed.
