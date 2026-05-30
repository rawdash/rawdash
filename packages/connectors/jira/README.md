<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-jira

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-jira)](https://www.npmjs.com/package/@rawdash/connector-jira)
[![license](https://img.shields.io/npm/l/@rawdash/connector-jira)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync projects, users, sprints, issues, and issue status-change events from a Jira Cloud site.

## Install

```sh
npm install @rawdash/connector-jira
```

## Authentication

Authenticates over HTTP Basic auth using your Atlassian account email and an API token. The token must belong to an account with access to the projects you want to sync.

1. Open id.atlassian.com -> Security -> Create and manage API tokens.
2. Create an API token and copy its value.
3. Store the token as a secret and reference it from the connector config as `apiToken: secret("JIRA_API_TOKEN")`, alongside your account email and site host (e.g. yourorg.atlassian.net).
4. Story points and the sprint association live on custom fields whose IDs differ per Jira site. Discover them at `https://{host}/rest/api/3/field` and set storyPointsField / sprintField to match.

## Configuration

| Field              | Type   | Required | Description                                                                                                                                                                                           |
| ------------------ | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`            | string | Yes      | Atlassian account email paired with the API token for Basic auth.                                                                                                                                     |
| `apiToken`         | secret | Yes      | Atlassian API token. Create one at id.atlassian.com → Security → API tokens.                                                                                                                          |
| `host`             | string | Yes      | Your Jira Cloud host, e.g. yourorg.atlassian.net (no protocol, no trailing slash).                                                                                                                    |
| `projectKeys`      | array  | No       | Restrict the sync to specific Jira project keys (e.g. ENG, OPS). Omit to sync every project the account can see.                                                                                      |
| `resources`        | array  | No       | Which Jira resources to sync. Omit to sync all of them. 'issue_events' shares the issues query - enabling it without 'issues' still fetches issues (with changelog) but skips writing issue entities. |
| `storyPointsField` | string | No       | Custom field ID holding story points (varies per site). Defaults to customfield_10016.                                                                                                                |
| `sprintField`      | string | No       | Custom field ID holding the sprint association on issues. Defaults to customfield_10020.                                                                                                              |

## Resources

- **`jira_project`** _(entity)_ - Jira projects with key, name, type, and project lead. Restrict via projectKeys to limit the sync.
  - Endpoint: `GET /rest/api/3/project/search`
- **`jira_user`** _(entity)_ - Atlassian accounts visible to the connector, including display name, email, account type, and active state.
  - Endpoint: `GET /rest/api/3/users/search`
- **`jira_sprint`** _(entity)_ - Sprints from scrum boards with state, start/end/complete dates, and owning board.
  - Endpoint: `GET /rest/agile/1.0/board/{boardId}/sprint`
- **`jira_issue`** _(entity)_ - Issues with status, priority, type, assignee, reporter, project, sprint, story points, and resolution date.
  - Endpoint: `GET /rest/api/3/search/jql`
  - sprintId is taken from the most recent sprint on the issue's sprint custom field.
- **`jira_issue_status_change`** _(event)_ - Status transition events derived from issue changelogs, capturing the from/to status, author, and project.
  - Endpoint: `GET /rest/api/3/search/jql (expand=changelog)`
  - start_ts is the changelog entry time, end_ts is null. Timestamps are Unix epoch milliseconds.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const jira = {
  name: 'jira',
  connectorId: 'jira',
  config: {
    email: 'you@yourorg.com',
    apiToken: secret('JIRA_API_TOKEN'),
    host: 'yourorg.atlassian.net',
    projectKeys: ['ENG'],
  },
};

export default defineConfig({
  connectors: [jira],
  dashboards: {
    delivery: defineDashboard({
      widgets: {
        open_issues: {
          kind: 'stat',
          title: 'Open Issues',
          metric: defineMetric({
            connector: jira,
            shape: 'entity',
            entityType: 'jira_issue',
            fn: 'count',
            filter: [{ field: 'statusCategory', op: 'neq', value: 'done' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Jira Cloud uses cost-based rate limiting; 429 responses with Retry-After are honored.

## Limitations

- Sprints are only synced from scrum boards; kanban boards are skipped.
- Issue status-change events are derived from each issue changelog; only `status` field transitions are written.
- Targets Jira Cloud REST API v3 and the Agile API; Jira Data Center / Server are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Atlassian API docs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
