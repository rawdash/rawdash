---
'@rawdash/connector-mixpanel': minor
---

Add `@rawdash/connector-mixpanel` — a Mixpanel connector that syncs DAU/WAU/MAU, per-event volume, declared funnel conversion data, and cohort retention into the six-shape storage model via the Mixpanel Query API. Authenticates with a project-scoped service account (HTTP Basic) and supports both US and EU data regions. Backfill (90-day default) and incremental (3-day rolling) sync modes are both supported, with phase-level resumable cursors and `options.resources` allowlist support so dashboards that only need a subset of resources don't pay for the others.
