<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-clickup

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-clickup)](https://www.npmjs.com/package/@rawdash/connector-clickup)
[![license](https://img.shields.io/npm/l/@rawdash/connector-clickup)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync spaces, folders, lists, tasks, and task lifecycle events from a ClickUp workspace for throughput, open-work, and status-distribution analytics.

## Install

```sh
npm install @rawdash/connector-clickup
```

## Authentication

Authenticates with a ClickUp personal API token sent in the Authorization header. The token scopes the sync to the workspaces, spaces, and tasks the issuing user can access.

1. Open ClickUp -> Settings -> Apps.
2. Under API Token, click Generate (or copy the existing personal token). It starts with pk\_.
3. Store it as a secret and reference it from the connector config as `apiToken: secret("CLICKUP_API_TOKEN")`, alongside your Workspace ID.

## Configuration

| Field       | Type   | Required | Description                                                                                                                                                                            |
| ----------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiToken`  | secret | Yes      | ClickUp personal API token. Create one at ClickUp -> Settings -> Apps -> API Token.                                                                                                    |
| `teamId`    | string | Yes      | ClickUp Workspace (team) ID to sync. Find it in the URL: app.clickup.com/<workspace_id>/home.                                                                                          |
| `resources` | array  | No       | Which ClickUp resources to sync. Omit to sync all of them. 'task_events' derives created / closed lifecycle events from each task's timestamps and shares the task query with 'tasks'. |

## Resources

- **`clickup_space`** _(entity)_ - Workspace spaces with their name and privacy flag.
  - Endpoint: `GET /team/{team_id}/space`
  - `name`: Space name.
  - `private`: Whether the space is private.
  - `archived`: Whether the space is archived.
- **`clickup_folder`** _(entity)_ - Folders within each space, with their parent space.
  - Endpoint: `GET /space/{space_id}/folder`
  - `name`: Folder name.
  - `spaceId`: Parent space id.
  - `taskCount`: Number of tasks across the folder at sync time.
  - `archived`: Whether the folder is archived.
- **`clickup_list`** _(entity)_ - Lists (folder-scoped and folderless) with their parent folder and space.
  - Endpoint: `GET /space/{space_id}/list and GET /folder/{folder_id}/list`
  - `name`: List name.
  - `folderId`: Parent folder id (null if folderless).
  - `spaceId`: Parent space id.
  - `taskCount`: Number of tasks in the list at sync time.
  - `archived`: Whether the list is archived.
- **`clickup_task`** _(entity)_ - Tasks with their status, priority, assignees, parent list / folder / space, tags, and lifecycle timestamps.
  - Endpoint: `GET /team/{team_id}/task`
  - `name`: Task name.
  - `status`: Current status name (e.g. "in progress").
  - `statusType`: Status category: open, custom, closed, or done.
  - `priority`: Priority label (urgent / high / normal / low), or null.
  - `listId`: Parent list id.
  - `folderId`: Parent folder id.
  - `spaceId`: Parent space id.
  - `assignees`: Assignee user ids.
  - `assigneeCount`: Number of assignees.
  - `tags`: Tag names on the task.
  - `createdAt`: When the task was created (Unix ms).
  - `closedAt`: When the task was closed (Unix ms; null if open).
  - `dueDate`: Task due date (Unix ms; null if unset).
- **`clickup_task_event`** _(event)_ - Task lifecycle events (created / closed) derived from each task's date_created and date_closed. The scope is cleared and rewritten from a full task scan on every sync (including incremental runs).
  - Endpoint: `GET /team/{team_id}/task`
  - Derived from each task's own date_created / date_closed timestamps, not from a separate per-task activity call. Drives created-per-day and closed-per-day throughput timeseries.
  - `kind`: "created" or "closed".
  - `taskId`: Task the event belongs to.
  - `listId`: Parent list id, denormalised.
  - `spaceId`: Parent space id, denormalised.
  - `status`: Task status name at sync time.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const clickup = {
  name: 'clickup',
  connectorId: 'clickup',
  config: {
    apiToken: secret('CLICKUP_API_TOKEN'),
    teamId: '9000000000',
  },
};

export default defineConfig({
  connectors: [clickup],
  dashboards: {
    product: defineDashboard({
      widgets: {
        open_tasks: {
          kind: 'stat',
          title: 'Open tasks',
          metric: defineMetric({
            connector: clickup,
            shape: 'entity',
            entityType: 'clickup_task',
            fn: 'count',
            filter: [{ field: 'statusType', op: 'eq', value: 'open' }],
          }),
        },
        tasks_closed: {
          kind: 'timeseries',
          title: 'Tasks closed per day',
          window: '30d',
          metric: defineMetric({
            connector: clickup,
            shape: 'event',
            name: 'clickup_task_event',
            fn: 'count',
            filter: [{ field: 'kind', op: 'eq', value: 'closed' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

ClickUp rate-limits per token (100 requests/minute on the Free Forever / Unlimited plans, higher on Business+) and exposes X-RateLimit-Remaining / X-RateLimit-Reset headers; the shared HTTP client backs off on 429.

## Limitations

- Personal API token auth only (OAuth app installs are out of scope).
- Task lifecycle events (created / closed) are derived from each task's own date_created / date_closed fields rather than the per-task activity feed, which avoids an N+1 sync; the event scope is cleared and rewritten from a full task scan on every sync.
- Custom fields, comments, time tracking, and goals are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [ClickUp API docs](https://clickup.com/api)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
