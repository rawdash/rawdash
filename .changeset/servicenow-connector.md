---
'@rawdash/connector-servicenow': minor
---

Add a ServiceNow connector that syncs incidents, incident state-change events, change requests, and problems from the ServiceNow Table API. Supports HTTP Basic auth, backfill + incremental sync (filtered on `sys_updated_on`), and server-side `state`/`priority` pushdown on incidents for incident-volume, MTTR, and change-throughput dashboards.
