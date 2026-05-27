---
'@rawdash/connector-jira': minor
---

Add `@rawdash/connector-jira` — syncs Jira Cloud issues, issue status-change events, sprints, projects, and users into the six-shape storage model. Authenticates with Basic auth (Atlassian account email + API token), scoped optionally to specific project keys. Backfills with `startAt` pagination over projects/users/sprints and `nextPageToken` pagination over the enhanced `/rest/api/3/search/jql` endpoint, then runs incremental sync via a `updated >=` JQL bound. Status transitions are derived from each issue's `expand=changelog`. Extends the engineering vertical beyond Linear-native shops.
