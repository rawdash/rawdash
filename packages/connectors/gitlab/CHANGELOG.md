# @rawdash/connector-gitlab

## 0.28.1

### Patch Changes

- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Patch Changes

- 32e45f3: Fix GitLab pipeline `duration_ms` and `finished_at` always being null. The pipelines list endpoint does not return `duration`, `started_at`, or `finished_at`; each pipeline is now enriched via the single-pipeline endpoint so pipeline entities and `pipeline_event` events carry the real duration and finish time.
- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0

## 0.27.0

### Patch Changes

- @rawdash/core@0.27.0

## 0.26.0

### Patch Changes

- @rawdash/core@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0

## 0.22.0

### Patch Changes

- beb78ff: Require a `domain` field on connector vendor metadata, and give each connector a vendor domain.

  `connectorDocSchema` now requires `vendor.domain` (a validated hostname), so every connector declares the vendor's domain. This is a breaking change for connector authors using `@rawdash/core` directly. All built-in connectors now set `vendor.domain`.

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0

## 0.21.1

### Patch Changes

- @rawdash/core@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

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
