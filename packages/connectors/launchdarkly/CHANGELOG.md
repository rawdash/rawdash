# @rawdash/connector-launchdarkly

## 0.18.0

### Minor Changes

- f469ba3: Add `@rawdash/connector-launchdarkly` - syncs LaunchDarkly projects, feature flags (with per-environment on/off and last-modified summaries), and audit-log events. Authenticates with a LaunchDarkly API access token; the audit log is incrementally bounded by `options.since` with a configurable backfill window.

### Patch Changes

- @rawdash/core@0.18.0
