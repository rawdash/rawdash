<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-klaviyo

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-klaviyo)](https://www.npmjs.com/package/@rawdash/connector-klaviyo)
[![license](https://img.shields.io/npm/l/@rawdash/connector-klaviyo)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync campaigns, flows, lists, and segments from Klaviyo for ecommerce email and SMS marketing analytics.

## Install

```sh
npm install @rawdash/connector-klaviyo
```

## Authentication

A Klaviyo Private API Key with read access to campaigns, flows, lists, and segments.

1. Open Klaviyo -> Settings -> API Keys and create a new Private API Key.
2. Grant read access to Campaigns, Flows, Lists, and Segments (or only the scopes you intend to sync).
3. Copy the generated key and store it as a secret, referencing it from the connector config as `apiKey: secret("KLAVIYO_API_KEY")`.

## Configuration

| Field         | Type                              | Required | Description                                                                                                                                          |
| ------------- | --------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`      | secret                            | Yes      | Klaviyo Private API Key with read scopes for campaigns, flows, lists, and segments. Create one at Klaviyo -> Settings -> API Keys.                   |
| `apiRevision` | string                            | No       | Value sent in the revision header. Defaults to 2024-10-15; pin a specific date here when upgrading deliberately.                                     |
| `channel`     | `email` \| `sms` \| `mobile_push` | No       | Which campaign channel to sync. The Klaviyo campaigns endpoint requires a channel filter and only returns one channel per call; defaults to 'email'. |
| `resources`   | array                             | No       | Which Klaviyo resources to sync. Omit to sync all of them. The key only needs read scopes for the resources listed here.                             |

## Resources

- **`klaviyo_list`** _(entity)_ - Klaviyo lists (manually managed subscriber collections) with opt-in process and created/updated timestamps.
  - Endpoint: `GET /api/lists`
  - `name`: List display name.
  - `optInProcess`: Opt-in process (e.g. single_opt_in, double_opt_in).
  - `createdAt`: When the list was created (Unix ms).
- **`klaviyo_segment`** _(entity)_ - Klaviyo segments (rule-based dynamic groups) with active, starred, and processing flags.
  - Endpoint: `GET /api/segments`
  - `name`: Segment display name.
  - `isActive`: Whether the segment is active.
  - `isStarred`: Whether the segment is starred.
  - `isProcessing`: Whether the segment is currently recomputing.
  - `createdAt`: When the segment was created (Unix ms).
- **`klaviyo_campaign`** _(entity)_ - Klaviyo campaigns for the configured channel, with status, archived flag, send strategy, and send time.
  - Endpoint: `GET /api/campaigns`
  - Klaviyo requires a channel filter on /campaigns; this connector syncs one channel per instance (the configured `channel` setting).
  - `name`: Campaign name.
  - `status`: Campaign status (Draft, Sent, etc.).
  - `archived`: Whether the campaign is archived.
  - `channel`: Campaign channel (email, sms, mobile_push).
  - `sendStrategy`: Send strategy method (static, smart_send_time, etc.).
  - `sendTime`: Scheduled or actual send time (Unix ms).
  - `createdAt`: When the campaign was created (Unix ms).
- **`klaviyo_flow`** _(entity)_ - Klaviyo flows (automation series) with status, trigger type, and archived flag.
  - Endpoint: `GET /api/flows`
  - `name`: Flow name.
  - `status`: Flow status (live, draft, manual).
  - `archived`: Whether the flow is archived.
  - `triggerType`: Flow trigger type (e.g. list, segment, metric).
  - `createdAt`: When the flow was created (Unix ms).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const klaviyo = {
  name: 'klaviyo',
  connectorId: 'klaviyo',
  config: {
    apiKey: secret('KLAVIYO_API_KEY'),
    apiRevision: '2024-10-15',
    channel: 'email',
  },
};

export default defineConfig({
  connectors: [klaviyo],
  dashboards: {
    marketing: defineDashboard({
      widgets: {
        active_segments: {
          kind: 'stat',
          title: 'Active segments',
          metric: defineMetric({
            connector: klaviyo,
            shape: 'entity',
            entityType: 'klaviyo_segment',
            fn: 'count',
            filter: [{ field: 'isActive', op: 'eq', value: true }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Klaviyo enforces per-endpoint burst and steady rate limits and signals them via the RateLimit-Remaining and RateLimit-Reset response headers. The shared HTTP client backs off on 429 and honors Retry-After.

## Limitations

- Campaign and flow statistics (campaign-values-reports / flow-values-reports) are not synced; the reports endpoints require a per-account conversion metric id and are deferred to a follow-up.
- Profile, event, catalog, and coupon objects are out of scope (niche for dashboard use).
- Only one campaign channel per sync (email, sms, or mobile_push) - the Klaviyo campaigns endpoint requires the filter and does not allow OR across channels.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Klaviyo API docs](https://developers.klaviyo.com/en/reference/api_overview)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
