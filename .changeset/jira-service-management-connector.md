---
'@rawdash/connector-jira-service-management': minor
---

Add a Jira Service Management connector that syncs service desks, customer requests, request status-change events, and SLA breach events. Uses Atlassian email + API token Basic auth (same shape as the Jira connector), reads requests via the Jira Cloud REST v3 issue search scoped to service desk projects, supports backfill + incremental sync (filtered on `updated`), auto-discovers SLA custom fields, and pushes `statusName`/`priority` filters down to JQL for request-volume, MTTR, and SLA-attainment dashboards.
