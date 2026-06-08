# @rawdash/connector-launchdarkly

## 0.20.0

### Patch Changes

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

- f469ba3: Add `@rawdash/connector-launchdarkly` - syncs LaunchDarkly projects, feature flags (with per-environment on/off and last-modified summaries), and audit-log events. Authenticates with a LaunchDarkly API access token; the audit log is incrementally bounded by `options.since` with a configurable backfill window.

### Patch Changes

- @rawdash/core@0.18.0
