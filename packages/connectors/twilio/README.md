<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-twilio

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-twilio)](https://www.npmjs.com/package/@rawdash/connector-twilio)
[![license](https://img.shields.io/npm/l/@rawdash/connector-twilio)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Track SMS and voice volume, delivery and error rates, and per-category spend from the Twilio REST API.

## Install

```sh
npm install @rawdash/connector-twilio
```

## Authentication

Authenticates over HTTP Basic auth using the Twilio Account SID as the username and the Auth token as the password. Read access to messages, calls, and usage records is sufficient.

1. Open the Twilio Console dashboard and copy your Account SID (starts with AC).
2. Copy the Auth token shown next to it.
3. Store the token as a secret (e.g. TWILIO_AUTH_TOKEN).
4. Reference it from config as `authToken: secret("TWILIO_AUTH_TOKEN")` alongside `accountSid: "AC..."`.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `accountSid`   | string | Yes      | Twilio Account SID (starts with AC). Found on the Twilio Console dashboard. Used as the Basic auth username and in every request path.     |
| `authToken`    | secret | Yes      | Twilio Auth token for the account, used as the Basic auth password.                                                                        |
| `resources`    | array  | No       | Which Twilio resources to sync. Omit to sync all of them. The two usage metrics share one upstream call to the daily Usage Records report. |
| `lookbackDays` | number | No       | How many days of usage history to fetch on a full sync. Defaults to 30. Message and call backfill is bounded by the same window.           |

## Resources

- **`twilio_message`** _(event)_ - SMS / MMS message attempts with status, error code, direction, and price, timestamped at the time the message was sent.
  - Endpoint: `GET /2010-04-01/Accounts/{AccountSid}/Messages.json`
  - start_ts is date_sent when present, falling back to date_created. Messages whose timestamp cannot be parsed are skipped.
  - `sid`: Twilio message SID.
  - `status`: Delivery status (queued, sending, sent, delivered, undelivered, failed, received, ...).
  - `errorCode`: Twilio error code if the message failed, else null.
  - `direction`: Message direction (inbound, outbound-api, outbound-call, outbound-reply).
  - `price`: Absolute price charged for the message in priceUnit, or null if not yet priced.
  - `priceUnit`: ISO currency code for price, or null.
  - `from`: Sender address or number.
  - `to`: Recipient address or number.
  - `numSegments`: Number of message segments billed.
  - `numMedia`: Number of media attachments.
  - `messagingServiceSid`: Messaging Service SID the message was sent through, or null.
- **`twilio_call`** _(event)_ - Voice call attempts with status, direction, duration, and price, timestamped at the call start time.
  - Endpoint: `GET /2010-04-01/Accounts/{AccountSid}/Calls.json`
  - start_ts is start_time when present, falling back to date_created. Calls whose timestamp cannot be parsed are skipped.
  - `sid`: Twilio call SID.
  - `status`: Call status (queued, ringing, in-progress, completed, busy, failed, no-answer, canceled).
  - `direction`: Call direction (inbound, outbound-api, outbound-dial).
  - `duration` _(seconds)_: Call duration in seconds.
  - `price`: Absolute price charged for the call in priceUnit, or null if not yet priced.
  - `priceUnit`: ISO currency code for price, or null.
  - `from`: Caller number.
  - `to`: Callee number.
- **`twilio_usage_count`** _(metric)_ - Daily usage count per Twilio billing category, from the daily Usage Records report.
  - Endpoint: `GET /2010-04-01/Accounts/{AccountSid}/Usage/Records/Daily.json`
  - Unit: count
  - Granularity: daily
  - Dimensions: `category`, `description`
  - Measures: `usage`
  - Sample value is the Usage Record count. Written from the same usage call as twilio_usage_price.
- **`twilio_usage_price`** _(metric)_ - Daily spend per Twilio billing category, from the daily Usage Records report.
  - Endpoint: `GET /2010-04-01/Accounts/{AccountSid}/Usage/Records/Daily.json`
  - Unit: currency
  - Granularity: daily
  - Dimensions: `category`, `description`
  - Sample value is the absolute Usage Record price in priceUnit. Written alongside twilio_usage_count from one usage call.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const twilio = {
  name: 'twilio',
  connectorId: 'twilio',
  config: {
    accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    authToken: secret('TWILIO_AUTH_TOKEN'),
  },
};

export default defineConfig({
  connectors: [twilio],
  dashboards: {
    messaging: defineDashboard({
      widgets: {
        spend_mtd: {
          kind: 'stat',
          title: 'Twilio spend (last 30d)',
          window: '30d',
          metric: defineMetric({
            connector: twilio,
            shape: 'metric',
            name: 'twilio_usage_price',
            fn: 'sum',
          }),
        },
        sends_today: {
          kind: 'stat',
          title: 'Usage count today',
          window: '1d',
          metric: defineMetric({
            connector: twilio,
            shape: 'metric',
            name: 'twilio_usage_count',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Twilio returns 429 with a Retry-After header when the per-account concurrency budget is exceeded; the shared HTTP client honors it. List endpoints paginate via a relative next_page_uri with a configurable PageSize (capped at 1000 here).

## Limitations

- Monetary amounts (message/call price, usage price) are reported by Twilio as negative-signed decimal strings; the connector stores their absolute value as a positive number.
- Message and call events are bounded by the backfill window; very high-volume accounts should sync the usage metrics rather than per-message events for spend and volume trends.
- Usage is read from the daily Usage Records report (1-day granularity); sub-daily usage is not exposed.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Twilio API docs](https://www.twilio.com/docs/usage/api)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
