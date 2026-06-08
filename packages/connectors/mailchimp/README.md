<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-mailchimp

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-mailchimp)](https://www.npmjs.com/package/@rawdash/connector-mailchimp)
[![license](https://img.shields.io/npm/l/@rawdash/connector-mailchimp)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Mailchimp campaigns, audiences (lists), automations, and per-campaign engagement stats for marketing email analytics.

## Install

```sh
npm install @rawdash/connector-mailchimp
```

## Authentication

A Mailchimp Marketing API key. The data-center suffix after the dash (e.g. `-us1`) selects the API host the connector talks to.

1. In Mailchimp, open Profile -> Extras -> API keys and create a new API key.
2. Copy the full key including the trailing data-center suffix (e.g. `abc123...-us1`); the suffix selects the API host.
3. Store the key as a secret and reference it from config as `apiKey: secret("MAILCHIMP_API_KEY")`.

## Configuration

| Field       | Type   | Required | Description                                                                                                                                         |
| ----------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`    | secret | Yes      | Mailchimp Marketing API key. The data-center suffix after the dash (e.g. `-us1`) selects the API host. Create one at Profile -> Extras -> API keys. |
| `resources` | array  | No       | Which Mailchimp resources to sync. Omit to sync all of them.                                                                                        |

## Resources

- **`mailchimp_campaign`** _(entity)_ - Campaigns (regular, plaintext, A/B, RSS, etc.) with status, type, subject line, sender, audience, send time, and total emails sent.
  - Endpoint: `GET /campaigns`
  - `status`: Campaign status (save, paused, schedule, sending, sent).
  - `type`: Campaign type (regular, plaintext, absplit, rss, etc.).
  - `subjectLine`: Email subject line.
  - `title`: Internal campaign title.
  - `fromName`: Sender display name.
  - `replyTo`: Reply-to email address.
  - `listId`: Audience (list) id the campaign targets.
  - `listName`: Audience (list) display name.
  - `createTime`: When the campaign was created (Unix ms).
  - `sendTime`: When the campaign was sent (Unix ms).
  - `emailsSent`: Total emails sent.
- **`mailchimp_list`** _(entity)_ - Audiences (lists) with member counts, engagement rates, and lifetime campaign count.
  - Endpoint: `GET /lists`
  - `name`: Audience name.
  - `memberCount`: Number of subscribed members.
  - `unsubscribeCount`: Number of unsubscribed members.
  - `cleanedCount`: Number of cleaned addresses.
  - `openRate`: Lifetime open rate as a fraction (0 to 1).
  - `clickRate`: Lifetime click rate as a fraction (0 to 1).
  - `campaignCount`: Number of campaigns sent to the audience.
  - `listRating`: Mailchimp star rating (0 to 5).
  - `createdAt`: When the audience was created (Unix ms).
- **`mailchimp_automation`** _(entity)_ - Automations (classic email workflows) with status, title, sender, audience, and lifetime emails sent.
  - Endpoint: `GET /automations`
  - `status`: Automation status (save, paused, sending).
  - `title`: Automation title.
  - `fromName`: Sender display name.
  - `replyTo`: Reply-to email address.
  - `listId`: Audience (list) id the automation targets.
  - `listName`: Audience (list) display name.
  - `emailsSent`: Total emails sent over the workflow lifetime.
  - `createTime`: When the automation was created (Unix ms).
  - `startTime`: When the automation was started (Unix ms).
- **`mailchimp_campaign_stats`** _(metric)_ - Per-campaign engagement stats (sent, opens, clicks, bounces, unsubscribes) timestamped at the campaign send time.
  - Endpoint: `GET /reports`
  - Unit: emails
  - Dimensions: `campaignId`, `campaignTitle`, `campaignType`, `listId`, `opensTotal`, `uniqueOpens`, `openRate`, `clicksTotal`, `uniqueClicks`, `clickRate`, `hardBounces`, `softBounces`, `unsubscribed`
  - One sample per campaign; value is the sent count, and every other counter is exposed in attributes. The scope is cleared and rewritten on every sync because the /reports endpoint has no `since` filter.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const mailchimp = {
  name: 'mailchimp',
  connectorId: 'mailchimp',
  config: {
    apiKey: secret('MAILCHIMP_API_KEY'),
  },
};

export default defineConfig({
  connectors: [mailchimp],
  dashboards: {
    marketing: defineDashboard({
      widgets: {
        emails_sent: {
          kind: 'stat',
          title: 'Emails sent (last 30d)',
          metric: defineMetric({
            connector: mailchimp,
            shape: 'metric',
            name: 'mailchimp_campaign_stats',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Mailchimp allows up to 10 simultaneous connections per account; per-endpoint rate limits are not advertised, so the connector keeps to sequential paginated requests.

## Limitations

- Per-campaign report stats are rewritten on every sync because the /reports endpoint has no `since` filter.
- Automations are synced as entities only; per-workflow open/click counts are out of scope.
- Member-level data, ecommerce stores, and landing pages are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Mailchimp API docs](https://mailchimp.com/developer/marketing/api/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
