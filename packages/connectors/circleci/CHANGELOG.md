# @rawdash/connector-circleci

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
