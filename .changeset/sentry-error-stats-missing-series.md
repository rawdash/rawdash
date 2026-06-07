---
'@rawdash/connector-sentry': patch
---

Fix the `error_stats` resource crashing with `Cannot read properties of undefined (reading 'sum(quantity)')` when Sentry's `stats_v2` response contains a group without a populated `series` (common for low-activity orgs). The `series` field is now optional in both the response schema and TypeScript type, and `writeErrorStats` guards the access and skips groups with no series instead of throwing — so the crash no longer stalls the entire Sentry sync cursor and lets `issues` + `releases` land.
