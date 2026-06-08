# @rawdash/connector-gitlab

## 0.20.0

### Patch Changes

- 4f0f30f: Fix the pipelines sync emitting duplicate `pipeline_event` rows for a single unique pipeline id. Pipeline entities collapse to one row per `(project, pipeline id)` via last-write-wins, but events were appended unconditionally inside the loop, so a page containing duplicate pipeline ids produced multiple events. Events are now deduped by `(project, pipeline id)` (last occurrence wins) to match entity semantics.
- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0

## 0.18.0

### Minor Changes

- ed81ad7: Add `@rawdash/connector-gitlab` - syncs projects, merge requests, pipelines (with synthesized lifecycle events), issues, and releases from GitLab.com or a self-hosted GitLab instance. Authenticates with a Personal Access Token (`read_api` scope) and scopes the sync via explicit `projectIds` and/or auto-discovery from configured `groupIds` (recursing into subgroups). Honors `options.since` via the GitLab `updated_after` filter and short-circuits Link-header pagination once a whole page falls past the cutoff. Per-project iteration is checkpointed via a `<projectIdx>|<pageUrl>` cursor inside each phase so chunked syncs resume cleanly mid-project. Respects GitLab's standard `RateLimit-Remaining` / `RateLimit-Reset` headers.

### Patch Changes

- @rawdash/core@0.18.0
