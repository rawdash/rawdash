# @rawdash/connector-jira

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0

## 0.17.0

### Patch Changes

- @rawdash/core@0.17.0

## 0.16.0

### Minor Changes

- 55a69aa: Add `@rawdash/connector-jira` — syncs Jira Cloud issues, issue status-change events, sprints, projects, and users into the six-shape storage model. Authenticates with Basic auth (Atlassian account email + API token), scoped optionally to specific project keys. Backfills with `startAt` pagination over projects/users/sprints and `nextPageToken` pagination over the enhanced `/rest/api/3/search/jql` endpoint, then runs incremental sync via a `updated >=` JQL bound. Status transitions are derived from each issue's `expand=changelog`. Extends the engineering vertical beyond Linear-native shops.

### Patch Changes

- Updated dependencies [422b711]
- Updated dependencies [79fdd64]
- Updated dependencies [a1c4c66]
- Updated dependencies [074ec25]
- Updated dependencies [022cbf1]
- Updated dependencies [e104540]
- Updated dependencies [9169ceb]
- Updated dependencies [5026a5b]
- Updated dependencies [c27c332]
- Updated dependencies [e8b014a]
- Updated dependencies [7060534]
- Updated dependencies [d52a6a8]
- Updated dependencies [d17a523]
  - @rawdash/core@0.16.0
