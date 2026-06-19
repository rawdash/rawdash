<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-hubspot

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-hubspot)](https://www.npmjs.com/package/@rawdash/connector-hubspot)
[![license](https://img.shields.io/npm/l/@rawdash/connector-hubspot)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync CRM contacts, companies, and deals plus deal stage-change events and marketing email campaign stats from HubSpot.

## Install

```sh
npm install @rawdash/connector-hubspot
```

## Authentication

A HubSpot private app access token with read scopes for the resources you sync (contacts, companies, deals, and marketing email).

1. In HubSpot, go to Settings → Integrations → Private Apps and create a private app.
2. Grant read scopes for the resources you intend to sync (CRM contacts, companies, deals, and marketing email).
3. Copy the generated access token (starts with `pat-`).
4. Store it as a secret and reference it from the connector config as `accessToken: secret("HUBSPOT_ACCESS_TOKEN")`.

## Configuration

| Field         | Type   | Required | Description                                                                                                                                                  |
| ------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accessToken` | secret | Yes      | HubSpot private app access token with read scopes for contacts, companies, deals, and marketing email. Create one at Settings → Integrations → Private Apps. |
| `resources`   | array  | No       | Which HubSpot resources to sync. Omit to sync all resources. The access token only needs read scopes for the resources listed here.                          |

## Resources

- **`hubspot_contact`** _(entity)_ - CRM contacts with email, lifecycle stage, lead status, owner, and creation time.
  - Endpoint: `POST /crm/v3/objects/contacts/search`
- **`hubspot_company`** _(entity)_ - CRM companies with name, domain, industry, lifecycle stage, and creation time.
  - Endpoint: `POST /crm/v3/objects/companies/search`
- **`hubspot_deal`** _(entity)_ - CRM deals with name, stage, pipeline, amount, close date, owner, and creation time.
  - Endpoint: `POST /crm/v3/objects/deals/search`
- **`hubspot_deal_stage_change`** _(event)_ - Deal stage-change events derived from deal property history, one event per stage transition.
  - Endpoint: `GET /crm/v3/objects/deals?propertiesWithHistory=dealstage`
- **`hubspot_email_campaign`** _(entity)_ - Marketing email campaigns with name, subject, sender, type, send date, and recipient count.
  - Endpoint: `GET /email/public/v1/campaigns/by-id`
- **`hubspot_email_stats`** _(metric)_ - Per-campaign marketing email engagement stats (sent, delivered, opened, clicked, bounced, unsubscribed) timestamped at the campaign send time.
  - Endpoint: `GET /email/public/v1/campaigns/{id}`
  - Unit: emails
  - Dimensions: `campaignId`, `campaignName`, `delivered`, `opened`, `clicked`, `bounced`, `unsubscribed`
  - One sample per campaign; value is the sent count, and every counter (delivered, opened, clicked, bounced, unsubscribed) is also exposed in attributes.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const hubspot = {
  name: 'hubspot',
  connectorId: 'hubspot',
  config: {
    accessToken: secret('HUBSPOT_ACCESS_TOKEN'),
    resources: ['contacts', 'companies', 'deals'],
  },
};

export default defineConfig({
  connectors: [hubspot],
  dashboards: {
    sales: defineDashboard({
      widgets: {
        open_deals: {
          kind: 'stat',
          title: 'Open Deals',
          metric: defineMetric({
            connector: hubspot,
            shape: 'entity',
            entityType: 'hubspot_deal',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

HubSpot allows 100 requests / 10s; the Search API caps results at 10,000 per query.

## Limitations

- Deal stage-change events are rewritten on every sync because the deal list endpoint has no incremental `since` filter.
- Marketing email campaign data comes from the legacy email campaigns API and is only available for marketing emails.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [HubSpot API docs](https://developers.hubspot.com/docs/api/overview)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
