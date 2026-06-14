---
'@rawdash/connector-sentry': patch
---

Fix `sentry_errors_per_hour` producing no data points. The org-level `stats_v2` request now sends `project=-1` (all accessible projects) when no specific projects are configured, instead of omitting the `project` param entirely — without it Sentry returns groups with empty series and the metric writes zero rows. Groups that come back with a missing or empty series now emit explicit zero samples for each interval, so a genuine no-error window reads as a real `0` rather than no data.
