---
'@rawdash/connector-linear': patch
---

Fix the Linear connector capturing the oldest, not the most recent, issue history entries. The issues query paged each issue's `history` connection forward (`history(first: N)`), which under Linear's GraphQL pagination returns the earliest N entries (`createdAt` ascending). For any issue with more than `historyPerIssue` (default 8) total history entries this silently dropped every recent state transition, leaving the `linear_issue_state_change` event stream incomplete. The connector now pages the history connection backward (`history(last: N)`) to capture the latest N entries. Also adds the missing `triage` and `duplicate` members to the `stateType` filterable values so they match Linear's `WorkflowState.type` enum.
