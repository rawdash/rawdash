---
'@rawdash/connector-jira': patch
---

Fix two silent data-loss bugs in incremental issue sync. (1) The incremental `updated >= "..."` JQL bound was rendered in UTC, but Jira evaluates JQL date literals in the authenticated account's timezone — for accounts behind UTC this shifted the lower bound forward and permanently dropped issues updated in the gap. The bound is now rendered in the account timezone fetched from `GET /rest/api/3/myself`, falling back to UTC. (2) `jira_issue_status_change` events were derived only from the changelog returned inline by the issue search, which truncates to the most recent ~100 changelog entries per issue; status transitions past that cap are now recovered by paging the dedicated `GET /rest/api/3/issue/{id}/changelog` endpoint when an issue's inline changelog is truncated.
