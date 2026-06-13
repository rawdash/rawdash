# @rawdash/connector-circleci

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

- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0

## 0.19.0

### Minor Changes

- 895222d: Add `@rawdash/connector-circleci` - syncs CircleCI pipelines, workflows, jobs, and workflow state-transition events into the six-shape storage model. Authenticates with a personal API token (`Circle-Token`), scoped to one or more project slugs (`gh/org/repo`, `bb/org/repo`, or `circleci/<orgId>/<projectId>`). Paginates pipelines newest-first per slug, fans out to fetch each pipeline's workflows (and optionally per-workflow jobs), and short-circuits once it crosses the configured lookback window (default 30 days). Jobs are off by default - opt in via `resources` because they add a per-workflow API call.

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0
