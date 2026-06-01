---
'@rawdash/connector-gitlab': minor
---

Add `@rawdash/connector-gitlab` - syncs projects, merge requests, pipelines (with synthesized lifecycle events), issues, and releases from GitLab.com or a self-hosted GitLab instance. Authenticates with a Personal Access Token (`read_api` scope) and scopes the sync via explicit `projectIds` and/or auto-discovery from configured `groupIds` (recursing into subgroups). Honors `options.since` via the GitLab `updated_after` filter and short-circuits Link-header pagination once a whole page falls past the cutoff. Per-project iteration is checkpointed via a `<projectIdx>|<pageUrl>` cursor inside each phase so chunked syncs resume cleanly mid-project. Respects GitLab's standard `RateLimit-Remaining` / `RateLimit-Reset` headers.
