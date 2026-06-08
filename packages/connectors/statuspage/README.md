<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-statuspage

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-statuspage)](https://www.npmjs.com/package/@rawdash/connector-statuspage)
[![license](https://img.shields.io/npm/l/@rawdash/connector-statuspage)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Atlassian Statuspage components, incidents, and incident updates - current component health, recent incident history, and per-update status transitions.

## Install

```sh
npm install @rawdash/connector-statuspage
```

## Authentication

A Statuspage REST API key is required. Keys are scoped to the issuing account and inherit that account read access; a read-only role is sufficient for the resources synced here.

1. Open Statuspage -> Manage Account -> API Info.
2. Copy the API Key (or generate one if none exists).
3. Store the key as a secret and reference it from the connector config as `apiKey: secret("STATUSPAGE_API_KEY")`.
4. Set `pageId` to your 12-character Page ID (shown on the same screen, e.g. `abc123def456`).

## Configuration

| Field                  | Type   | Required | Description                                                                                                                                                                                                 |
| ---------------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`               | secret | Yes      | Statuspage REST API key. Create one at Manage Account -> API Info -> API Key.                                                                                                                               |
| `pageId`               | string | Yes      | Statuspage page id (the 12-character identifier shown next to your page name in Manage Account -> API Info, also visible in the admin URL).                                                                 |
| `resources`            | array  | No       | Which Statuspage resources to sync. Omit to sync all of them. 'incident_updates' rides the 'incidents' phase - enabling it without 'incidents' still fetches incidents but skips writing incident entities. |
| `incidentLookbackDays` | number | No       | How many days back to fetch incidents (and their updates) on a full sync. Defaults to 90. Statuspage returns incidents newest-first; this caps the backfill window.                                         |

## Resources

- **`statuspage_component`** _(entity)_ - Statuspage components (the things on a status page that turn red), with current status, group membership, and whether they are hidden until degraded.
  - Endpoint: `GET /v1/pages/{page_id}/components`
  - `name`: Component display name.
  - `status`: Current health: operational | under_maintenance | degraded_performance | partial_outage | major_outage.
  - `groupId`: Parent component-group id, or null if the component is top-level.
  - `group`: True if this row is itself a component group.
  - `showcase`: Whether the component is shown on the public page.
  - `onlyShowIfDegraded`: When true the component is hidden on the public page while operational.
  - `position`: Sort position within the page or group.
- **`statuspage_incident`** _(entity)_ - Statuspage incidents (realtime outages plus maintenance windows) with status, impact, affected components, and the created / monitoring / resolved timestamps.
  - Endpoint: `GET /v1/pages/{page_id}/incidents`
  - Returned newest-first by updated_at; bounded by the incident lookback window (default 90 days) and tightened to options.since on incremental syncs.
  - `name`: Incident title.
  - `status`: Realtime status (investigating | identified | monitoring | resolved | postmortem) or maintenance status (scheduled | in_progress | verifying | completed).
  - `impact`: Reported impact: none | maintenance | minor | major | critical.
  - `componentIds`: Ids of components currently attached to the incident.
  - `createdAt`: Incident creation timestamp (epoch ms).
  - `resolvedAt`: Resolved timestamp (epoch ms), or null while the incident is open.
  - `shortlink`: Public-facing short URL for the incident.
- **`statuspage_incident_update`** _(event)_ - Per-update transitions inside an incident timeline (each comment / status flip). Emitted at display_at (falling back to created_at).
  - Endpoint: `GET /v1/pages/{page_id}/incidents`
  - Derived from the inline incident_updates array on each incident; Statuspage does not expose a separate list endpoint.
  - `updateId`: Incident-update id.
  - `incidentId`: Parent incident id.
  - `status`: Status the incident moved to at this update.
  - `body`: Free-form message posted on the update.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const statuspage = {
  name: 'statuspage',
  connectorId: 'statuspage',
  config: {
    apiKey: secret('STATUSPAGE_API_KEY'),
    pageId: 'abc123def456',
  },
};

export default defineConfig({
  connectors: [statuspage],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        open_incidents: {
          kind: 'stat',
          title: 'Open incidents',
          metric: defineMetric({
            connector: statuspage,
            shape: 'entity',
            entityType: 'statuspage_incident',
            fn: 'count',
            filter: [{ field: 'status', op: 'neq', value: 'resolved' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Statuspage rate-limits at roughly 1 request/second per page; this connector paginates sequentially and respects 429 Retry-After. The page size is 100.

## Limitations

- Better Stack Uptime is a separate package and is tracked as a follow-up.
- Postmortem bodies, subscribers, metrics-provider configs, and template management are out of scope.
- Component groups are exposed via each component group_id but are not synced as separate entities.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Atlassian Statuspage API docs](https://developer.statuspage.io/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
