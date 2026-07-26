<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-pipedrive

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-pipedrive)](https://www.npmjs.com/package/@rawdash/connector-pipedrive)
[![license](https://img.shields.io/npm/l/@rawdash/connector-pipedrive)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync deals, deal stage-change events, pipelines, and activities from Pipedrive for open-pipeline value, win rate, and deals-closed analytics.

## Install

```sh
npm install @rawdash/connector-pipedrive
```

## Authentication

A Pipedrive personal API token with read access to the resources you sync (deals, pipelines, and activities). The token is passed as the `api_token` query parameter, per Pipedrive API-token authentication.

1. In Pipedrive, open Settings -> Personal preferences -> API.
2. Copy your personal API token (regenerate it there if you need a fresh one).
3. Store it as a secret and reference it from the connector config as `apiToken: secret("PIPEDRIVE_API_TOKEN")`, alongside your company domain (the "acme" in acme.pipedrive.com).

## Configuration

| Field           | Type   | Required | Description                                                                                                                     |
| --------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `companyDomain` | string | Yes      | Your Pipedrive company domain, the "acme" in acme.pipedrive.com.                                                                |
| `apiToken`      | secret | Yes      | Pipedrive personal API token with read access. Find it under Settings -> Personal preferences -> API.                           |
| `resources`     | array  | No       | Which Pipedrive resources to sync. Omit to sync all of them. The API token only needs read access to the resources listed here. |

## Resources

- **`pipedrive_deal`** _(entity)_ - Deals with title, status, value, stage, pipeline, owner, and lifecycle timestamps.
  - Endpoint: `GET /api/v1/deals`
  - `title`: Deal title.
  - `status`: Deal status (open, won, lost, deleted).
  - `value`: Deal monetary value.
  - `currency`: Currency code for the deal value.
  - `stageId`: Current pipeline stage id.
  - `pipelineId`: Pipeline the deal belongs to.
  - `ownerId`: Owning user id.
  - `personId`: Linked person id (null if none).
  - `orgId`: Linked organization id (null if none).
  - `probability`: Win probability percentage (null if unset).
  - `active`: Whether the deal is active.
  - `closeTime`: When the deal was closed (Unix ms, null if open).
  - `wonTime`: When the deal was marked won (Unix ms, null otherwise).
  - `lostTime`: When the deal was marked lost (Unix ms, null otherwise).
  - `lostReason`: Free-text reason the deal was lost (null if not lost).
  - `expectedCloseDate`: Expected close date (Unix ms, null if unset).
  - `createdAt`: When the deal was created (Unix ms).
- **`pipedrive_deal_stage_change`** _(event)_ - Deal stage-change events derived from each deal’s change history, one event per stage transition.
  - Endpoint: `GET /api/v1/deals/{id}/flow`
  - Derived from each deal’s flow; the scope is cleared and rewritten on every sync.
  - `dealId`: The deal the transition belongs to.
  - `fromStageId`: Stage id the deal moved from (null if unknown).
  - `toStageId`: Stage id the deal moved to.
  - `userId`: User who made the change (null if unknown).
- **`pipedrive_pipeline`** _(entity)_ - Sales pipelines used to group deal stages.
  - Endpoint: `GET /api/v1/pipelines`
  - `name`: Pipeline name.
  - `active`: Whether the pipeline is active.
  - `dealProbability`: Whether deal probability is enabled for this pipeline.
  - `orderNr`: Display order of the pipeline.
  - `createdAt`: When the pipeline was created (Unix ms).
- **`pipedrive_activity`** _(entity)_ - Activities (calls, meetings, tasks, emails) linked to deals, people, and organizations.
  - Endpoint: `GET /api/v1/activities`
  - `type`: Activity type key (call, meeting, etc.).
  - `subject`: Activity subject line.
  - `done`: Whether the activity is completed.
  - `dealId`: Linked deal id (null if none).
  - `personId`: Linked person id (null if none).
  - `orgId`: Linked organization id (null if none).
  - `userId`: Assigned user id.
  - `dueDate`: Due date (Unix ms at UTC midnight, null if unset).
  - `doneTime`: When the activity was marked done (Unix ms, null if not).
  - `createdAt`: When the activity was created (Unix ms).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const pipedrive = {
  name: 'pipedrive',
  connectorId: 'pipedrive',
  config: {
    companyDomain: 'acme',
    apiToken: secret('PIPEDRIVE_API_TOKEN'),
    resources: ['deals', 'pipelines', 'activities'],
  },
};

export default defineConfig({
  connectors: [pipedrive],
  dashboards: {
    sales: defineDashboard({
      widgets: {
        open_deals: {
          kind: 'stat',
          title: 'Open Deals',
          metric: defineMetric({
            connector: pipedrive,
            shape: 'entity',
            entityType: 'pipedrive_deal',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Pipedrive applies a per-token budget (roughly the plan-based daily allowance plus a burst limit) and signals throttling via 429 with a Retry-After header; the shared HTTP client honors Retry-After on backoff.

## Limitations

- Deal stage-change events are derived from each deal’s change history (GET /deals/{id}/flow), one request per deal, and the event scope is cleared and rewritten on every sync.
- Deals sync incrementally by `update_time`; pipelines and activities are re-listed in full on every sync.
- Custom deal and activity fields are not synced; only the standard fields listed below are stored.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Pipedrive API docs](https://developers.pipedrive.com/docs/api/v1)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
