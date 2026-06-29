---
'@rawdash/connector-mixpanel': patch
---

Fix Mixpanel active-user, resource-allowlist, and Query API path bugs. Daily/weekly/monthly active users are now read from the Aggregate Event Counts report (`/api/query/events`) instead of the Segmentation report, whose `unit` parameter does not support `week` — weekly active users were previously queried with an unsupported unit. The `resources` allowlist is now matched against resource names (`mixpanel_dau`, `mixpanel_funnel_results`, …) instead of internal phase names, so a targeted sync requesting specific resources fetches them instead of skipping everything. All Query API requests now target the documented `/api/query/` base path rather than the legacy `/api/2.0/` prefix.
