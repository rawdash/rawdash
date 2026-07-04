<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-resend

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-resend)](https://www.npmjs.com/package/@rawdash/connector-resend)
[![license](https://img.shields.io/npm/l/@rawdash/connector-resend)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync sent-email activity and sending-domain status from Resend to chart send volume, delivery and bounce rates, and domain verification on a dashboard.

## Install

```sh
npm install @rawdash/connector-resend
```

## Authentication

A Resend API key sent as a Bearer token. A read-only (Sending access is not required) key scoped to the account is enough to list emails and domains.

1. In the Resend dashboard open the API Keys page and create a new API key.
2. Give it Full access or Read-only access; the connector only reads.
3. Copy the key (it starts with `re_`) and store it as a secret, then reference it from config as `apiKey: secret("RESEND_API_KEY")`.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                                                                                             |
| -------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`       | secret | Yes      | A Resend API key with read access. Create one in the Resend dashboard under API Keys.                                                                                                                                                   |
| `lookbackDays` | number | No       | How many days of sent-email history to page back through on a full sync. Resend lists emails newest first with no server-side date filter, so the connector stops paging once it reaches emails older than this window. Defaults to 90. |
| `resources`    | array  | No       | Which Resend resources to sync. Omit to sync all of them.                                                                                                                                                                               |

## Resources

- **`resend_email`** _(event)_ - One event per email sent through Resend, timestamped at creation, carrying its latest delivery state, sender, sending domain, subject, and recipient count.
  - Endpoint: `GET /emails`
  - Paged newest-first; full syncs stop at the lookback window and incremental syncs stop once a page predates the last sync. Events are append-only, so each email reflects the delivery state captured when it was first synced.
  - `emailId`: Resend email id.
  - `messageId`: RFC 2822 Message-ID header value.
  - `from`: Sender address (with optional display name).
  - `fromDomain`: Domain portion of the sender address, lowercased.
  - `subject`: Email subject line.
  - `lastEvent`: Most recent delivery state (e.g. delivered, bounced, complained) as of the sync that captured the email.
  - `recipientCount`: Number of primary (To) recipients.
  - `hasCc`: Whether the email had Cc recipients.
  - `hasBcc`: Whether the email had Bcc recipients.
  - `scheduledAt`: Scheduled send time in epoch milliseconds, if scheduled.
- **`resend_domain`** _(entity)_ - Sending domains configured in the Resend account, with verification status, region, and send/receive capabilities.
  - Endpoint: `GET /domains`
  - `name`: Domain name.
  - `status`: Verification status (e.g. verified, pending, not_started, failed, temporary_failure).
  - `region`: Sending region for the domain.
  - `sending`: Sending capability state for the domain.
  - `receiving`: Receiving capability state for the domain.
  - `createdAt`: When the domain was created, in epoch milliseconds.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const resend = {
  name: 'resend',
  connectorId: 'resend',
  config: {
    apiKey: secret('RESEND_API_KEY'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [resend],
  dashboards: {
    email: defineDashboard({
      widgets: {
        sent_7d: {
          kind: 'stat',
          title: 'Emails sent (7d)',
          window: '7d',
          metric: defineMetric({
            connector: resend,
            shape: 'event',
            name: 'resend_email',
            fn: 'count',
          }),
        },
        daily_sent: {
          kind: 'timeseries',
          title: 'Daily emails sent',
          window: '30d',
          metric: defineMetric({
            connector: resend,
            shape: 'event',
            name: 'resend_email',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Resend rate-limits requests per API key (2 requests/second by default) and returns 429 with a Retry-After header when exceeded; the connector issues sequential paginated requests and relies on the shared HTTP client to honor 429 backoff.

## Limitations

- Resend exposes no analytics or aggregate-stats API, so send volume, delivery rate, and bounce rate are computed at the widget level from the per-email event stream rather than read from a metrics endpoint.
- Each email event carries the delivery state (lastEvent) as of the sync that first captured it. Resend list responses are not filterable by update time, so an email whose state advances (for example sent then delivered) after it was first synced is not revisited on incremental syncs.
- Full syncs page newest-first until they reach the lookback window; email history older than the configured lookback is not backfilled.
- Received-email and broadcast resources are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Resend API docs](https://resend.com/docs/api-reference/introduction)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
