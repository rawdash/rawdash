<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-calendly

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-calendly)](https://www.npmjs.com/package/@rawdash/connector-calendly)
[![license](https://img.shields.io/npm/l/@rawdash/connector-calendly)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Calendly event types, scheduled events, and cancellations for booking, no-show, and meeting-mix dashboards.

## Install

```sh
npm install @rawdash/connector-calendly
```

## Authentication

Authenticates with a personal access token sent as a Bearer credential. The token inherits the permissions of the account that created it, so use an organization admin to sync organization-wide scheduled events.

1. Sign in to Calendly and open Integrations -> API & Webhooks -> Personal Access Tokens.
2. Create a token, give it a name, and copy the value (it is shown only once).
3. Store the token as a secret and reference it from the connector config as `apiToken: secret("CALENDLY_API_TOKEN")`.
4. Fetch your organization URI from GET https://api.calendly.com/users/me (the `current_organization` field) and set it as `organizationUri`.

## Configuration

| Field             | Type   | Required | Description                                                                                                                                                                                                                        |
| ----------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiToken`        | secret | Yes      | Calendly personal access token with read access. Create one under Integrations -> API & Webhooks -> Personal Access Tokens.                                                                                                        |
| `organizationUri` | string | Yes      | The full Calendly organization URI to sync. Fetch it from GET https://api.calendly.com/users/me (current_organization).                                                                                                            |
| `lookbackDays`    | number | No       | How many days of past scheduled events to sync. Defaults to 90. Events are synced over a rolling window and rewritten on every sync.                                                                                               |
| `resources`       | array  | No       | Which Calendly resources to sync. Omit to sync all of them. 'cancellations' is derived from the scheduled-events scan, so enabling it without 'scheduled_events' still walks scheduled events but only writes cancellation events. |

## Resources

- **`calendly_event_type`** _(entity)_ - Event types (meeting templates) in the organization with name, active state, duration, kind, and owner.
  - Endpoint: `GET /event_types?organization={organizationUri}`
  - `name`: Event type name.
  - `active`: Whether the event type is active.
  - `slug`: URL slug of the event type.
  - `kind`: Event type kind (e.g. solo, group).
  - `poolingType`: Pooling type for round-robin/collective types.
  - `durationMinutes`: Default duration in minutes.
  - `color`: Display color.
  - `schedulingUrl`: Public scheduling URL.
  - `ownerUri`: URI of the owning user or team.
  - `ownerType`: Owner type (user or team).
  - `createdAt`: Creation time (epoch ms).
- **`calendly_scheduled_event`** _(event)_ - Scheduled events (bookings) timestamped at their start time, carrying status, event type, host, invitee, and no-show info.
  - Endpoint: `GET /scheduled_events?organization={organizationUri}`
  - start_ts is the meeting start time, end_ts the meeting end time. Invitee email and no-show counts come from the per-event invitees endpoint. Timestamps are Unix epoch milliseconds.
  - `uri`: Calendly scheduled event URI.
  - `name`: Event name.
  - `eventTypeUri`: URI of the booked event type.
  - `status`: Event status (active or canceled).
  - `canceled`: Whether the event was canceled.
  - `inviteeEmail`: Email of the primary invitee, if available.
  - `inviteeName`: Name of the primary invitee.
  - `inviteeCount`: Total invitees on the event.
  - `activeInviteeCount`: Invitees that have not canceled.
  - `noShowCount`: Number of invitees marked as no-show.
  - `hostEmail`: Email of the first host.
  - `hostName`: Name of the first host.
  - `locationType`: Meeting location type.
  - `createdAt`: Booking creation time (epoch ms).
  - `updatedAt`: Last update time (epoch ms).
- **`calendly_cancellation`** _(event)_ - Cancellation events derived from canceled scheduled events, timestamped at cancellation time with reason and canceler.
  - Endpoint: `GET /scheduled_events?organization={organizationUri}`
  - Derived from the scheduled-events scan; one event per canceled scheduled event. start_ts is the cancellation time. Timestamps are Unix epoch milliseconds.
  - `eventUri`: URI of the canceled scheduled event.
  - `eventName`: Name of the canceled event.
  - `eventTypeUri`: URI of the booked event type.
  - `reason`: Cancellation reason, if provided.
  - `canceledBy`: Name of who canceled.
  - `cancelerType`: Whether the host or invitee canceled.
  - `eventStartTime`: Start time of the canceled event (epoch ms).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const calendly = {
  name: 'calendly',
  connectorId: 'calendly',
  config: {
    apiToken: secret('CALENDLY_API_TOKEN'),
    organizationUri: 'https://api.calendly.com/organizations/AAAAAAAAAAAAAAAA',
  },
};

export default defineConfig({
  connectors: [calendly],
  dashboards: {
    scheduling: defineDashboard({
      widgets: {
        bookings_30d: {
          kind: 'stat',
          title: 'Bookings (30d)',
          window: '30d',
          metric: defineMetric({
            connector: calendly,
            shape: 'event',
            name: 'calendly_scheduled_event',
            fn: 'count',
          }),
        },
        bookings_per_day: {
          kind: 'timeseries',
          title: 'Bookings per day',
          window: '30d',
          granularity: 'day',
          metric: defineMetric({
            connector: calendly,
            shape: 'event',
            name: 'calendly_scheduled_event',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Calendly enforces per-token rate limits and returns HTTP 429 with a Retry-After header when exceeded; the shared HTTP client honors it with backoff. Enabling scheduled events fetches invitees per event, which increases request volume on large windows.

## Limitations

- Scheduled events and cancellations are synced over a rolling window (lookbackDays back through 60 days ahead) and rewritten on every sync, so bookings outside the window age out.
- No-show and invitee email are read from the per-event invitees endpoint, so they are only populated when the scheduled_events resource is enabled.
- Cancellation events are derived from canceled scheduled events within the window; a cancellation of an event whose start time has aged out of the window is not retained.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Calendly API docs](https://developer.calendly.com/api-docs)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
