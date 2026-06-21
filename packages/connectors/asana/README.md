<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-asana

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-asana)](https://www.npmjs.com/package/@rawdash/connector-asana)
[![license](https://img.shields.io/npm/l/@rawdash/connector-asana)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync projects, users, tasks, and task state-change events from an Asana workspace.

## Install

```sh
npm install @rawdash/connector-asana
```

## Authentication

Authenticates with a personal access token sent as a Bearer credential. The token inherits the permissions of the account that created it.

1. Open app.asana.com -> Settings -> Apps -> Developer apps.
2. Under Personal access tokens, create a new token and copy its value.
3. Store the token as a secret and reference it from the connector config as `apiToken: secret("ASANA_API_TOKEN")`, alongside the numeric workspaceGid.
4. Find your workspace GID at https://app.asana.com/api/1.0/workspaces while authenticated.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                                                               |
| -------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiToken`     | secret | Yes      | Asana personal access token. Create one at app.asana.com → Settings → Apps → Developer apps → Personal access tokens.                                                                                     |
| `workspaceGid` | string | Yes      | Numeric GID of the workspace to sync. Find it at app.asana.com/api/1.0/workspaces.                                                                                                                        |
| `projectGids`  | array  | No       | Restrict the task sync to specific project GIDs. Omit to sync tasks from every project in the workspace.                                                                                                  |
| `resources`    | array  | No       | Which Asana resources to sync. Omit to sync all of them. 'task_events' shares the tasks scan - enabling it without 'tasks' still walks tasks (and fetches their stories) but skips writing task entities. |

## Resources

- **`asana_project`** _(entity)_ - Projects in the workspace with name, archived state, owner, team, and timestamps.
  - Endpoint: `GET /projects`
- **`asana_user`** _(entity)_ - Users in the workspace with display name and email.
  - Endpoint: `GET /users`
- **`asana_task`** _(entity)_ - Tasks with completion state, assignee, due date, owning project, and timestamps.
  - Endpoint: `GET /tasks?project={projectGid}`
  - Tasks are walked project-by-project; a task in multiple projects is attributed to the first project scanned.
- **`asana_task_event`** _(event)_ - Task state-change events derived from system stories (completed, assigned, due-date changes, etc.).
  - Endpoint: `GET /tasks/{taskGid}/stories`
  - Only system stories are written; comments are skipped. start_ts is the story time, end_ts is null. Timestamps are Unix epoch milliseconds.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const asana = {
  name: 'asana',
  connectorId: 'asana',
  config: {
    apiToken: secret('ASANA_API_TOKEN'),
    workspaceGid: '1201234567890',
  },
};

export default defineConfig({
  connectors: [asana],
  dashboards: {
    delivery: defineDashboard({
      widgets: {
        open_tasks: {
          kind: 'stat',
          title: 'Open Tasks',
          metric: defineMetric({
            connector: asana,
            shape: 'entity',
            entityType: 'asana_task',
            fn: 'count',
            filter: [{ field: 'completed', op: 'eq', value: false }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Asana enforces per-token rate limits (150 req/min on free plans, 1500 on paid); 429 responses with Retry-After are honored.

## Limitations

- Task state-change events are derived from each task story; only system stories (not comments) are written.
- A task in multiple projects is stored once, attributed to the first project it is scanned under.
- Workspace-wide task search requires a paid plan, so tasks are walked project-by-project; omit projectGids to scan every project.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Asana API docs](https://developers.asana.com/reference/rest-api-reference)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
