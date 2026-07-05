<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-cal-com

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-cal-com)](https://www.npmjs.com/package/@rawdash/connector-cal-com)
[![license](https://img.shields.io/npm/l/@rawdash/connector-cal-com)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Cal.com event types, bookings, and cancellations for booking-volume, no-show, and meeting-mix dashboards.

## Install

```sh
npm install @rawdash/connector-cal-com
```

## Authentication

Authenticates with a Cal.com API key sent as a Bearer credential. The key inherits the permissions of the account that created it, so use an account with visibility into the event types and bookings you want to sync.

1. Sign in to Cal.com and open Settings -> Developer -> API keys.
2. Create an API key, give it a name, and copy the value (it is shown only once). Keys are prefixed with cal\_.
3. Store the key as a secret and reference it from the connector config as `apiKey: secret("CAL_API_KEY")`.
4. When self-hosting Cal.com, set `apiBaseUrl` to your instance API URL (for example https://cal.example.com/api/v2 without the trailing /v2). It defaults to https://api.cal.com.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                                                               |
| -------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`       | secret | Yes      | Cal.com API key with read access. Create one under Settings -> Developer -> API keys. Keys are prefixed with cal\_.                                                                                       |
| `apiBaseUrl`   | string | No       | Base URL of the Cal.com API. Defaults to https://api.cal.com. Set this to your instance API URL when self-hosting.                                                                                        |
| `lookbackDays` | number | No       | How many days of past bookings to sync. Defaults to 90. Bookings are synced over a rolling window and rewritten on every sync.                                                                            |
| `resources`    | array  | No       | Which Cal.com resources to sync. Omit to sync all of them. 'cancellations' is derived from the bookings scan, so enabling it without 'bookings' still walks bookings but only writes cancellation events. |

## Resources

- **`cal_com_event_type`** _(entity)_ - Event types (meeting templates) owned by the account, with title, slug, length, price, and visibility.
  - Endpoint: `GET /v2/event-types`
  - `title`: Event type title.
  - `slug`: URL slug of the event type.
  - `description`: Event type description.
  - `lengthMinutes`: Default duration in minutes.
  - `hidden`: Whether the event type is hidden.
  - `price`: Booking price in minor currency units.
  - `currency`: Currency code for the price.
  - `ownerId`: Numeric id of the owning user.
- **`cal_com_booking`** _(event)_ - Bookings timestamped at their start time, carrying status, event type, host, attendee, and no-show info.
  - Endpoint: `GET /v2/bookings`
  - start_ts is the booking start time, end_ts the end time. Attendee and no-show info come from the booking attendee list. Timestamps are Unix epoch milliseconds.
  - `uid`: Cal.com booking uid.
  - `title`: Booking title.
  - `status`: Booking status (accepted, pending, rejected, or cancelled).
  - `cancelled`: Whether the booking was cancelled.
  - `eventTypeId`: Numeric id of the booked event type.
  - `eventTypeSlug`: Slug of the booked event type.
  - `attendeeEmail`: Email of the primary attendee.
  - `attendeeName`: Name of the primary attendee.
  - `attendeeCount`: Number of attendees on the booking.
  - `noShowCount`: Number of attendees marked absent.
  - `hostEmail`: Email of the first host.
  - `hostName`: Name of the first host.
  - `location`: Meeting location or URL.
  - `durationMinutes`: Booking duration in minutes.
  - `createdAt`: Booking creation time (epoch ms).
  - `updatedAt`: Last update time (epoch ms).
- **`cal_com_cancellation`** _(event)_ - Cancellation events derived from cancelled bookings, timestamped at cancellation time with reason and canceller.
  - Endpoint: `GET /v2/bookings`
  - Derived from the bookings scan; one event per cancelled booking. start_ts is the booking update time (cancellation time). Timestamps are Unix epoch milliseconds.
  - `bookingUid`: Uid of the cancelled booking.
  - `title`: Title of the cancelled booking.
  - `eventTypeId`: Numeric id of the booked event type.
  - `reason`: Cancellation reason, if provided.
  - `cancelledByEmail`: Email of who cancelled the booking.
  - `bookingStartTime`: Start time of the cancelled booking (epoch ms).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const calCom = {
  name: 'cal-com',
  connectorId: 'cal-com',
  config: {
    apiKey: secret('CAL_API_KEY'),
  },
};

export default defineConfig({
  connectors: [calCom],
  dashboards: {
    scheduling: defineDashboard({
      widgets: {
        bookings_30d: {
          kind: 'stat',
          title: 'Bookings (30d)',
          window: '30d',
          metric: defineMetric({
            connector: calCom,
            shape: 'event',
            name: 'cal_com_booking',
            fn: 'count',
          }),
        },
        bookings_per_day: {
          kind: 'timeseries',
          title: 'Bookings per day',
          window: '30d',
          granularity: 'day',
          metric: defineMetric({
            connector: calCom,
            shape: 'event',
            name: 'cal_com_booking',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Cal.com enforces per-key rate limits and returns HTTP 429 with a Retry-After header when exceeded; the shared HTTP client honors it with backoff.

## Limitations

- Bookings and cancellations are synced over a rolling window (lookbackDays back through 60 days ahead) and rewritten on every sync, so bookings outside the window age out.
- Cancellation events are timestamped at the booking-record update time, since Cal.com does not expose a distinct cancellation timestamp.
- No-show counts are read from the per-booking attendee absence flags, so they only reflect hosts marking attendees absent.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Cal.com API docs](https://cal.com/docs/api-reference/v2/introduction)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
