---
'@rawdash/connector-launchdarkly': minor
---

Add `@rawdash/connector-launchdarkly` - syncs LaunchDarkly projects, feature flags (with per-environment on/off and last-modified summaries), and audit-log events. Authenticates with a LaunchDarkly API access token; the audit log is incrementally bounded by `options.since` with a configurable backfill window.
