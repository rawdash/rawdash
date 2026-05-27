# @rawdash/connector-hubspot

Rawdash connector for HubSpot — syncs CRM contacts, companies, and deals, deal stage-change events, and marketing email campaign performance into the six-shape storage model. Covers both the sales (pipeline, win rate) and marketing (email engagement) verticals from a single connector.

## Auth setup

The connector authenticates with a **private app access token**.

1. In HubSpot, go to **Settings → Integrations → Private Apps**.
2. Click **Create a private app**.
3. On the **Basic Info** tab, give it a name (e.g. `rawdash`).
4. On the **Scopes** tab, enable read access for the resources you want to sync:
   - `crm.objects.contacts.read`
   - `crm.objects.companies.read`
   - `crm.objects.deals.read`
   - `marketing-email` (only needed for `email_campaigns` / `email_stats`)
5. Click **Create app**, then **Continue creating** to confirm.
6. Open the app's **Auth** tab and copy the **Access token** (starts with `pat-`).

> **Note:** The token only needs read scopes for the resources you actually sync. Pick the narrowest set that covers your dashboards.

## Configuration

```ts
import { secret } from '@rawdash/core';

const hubspot = {
  name: 'hubspot',
  connectorId: 'hubspot',
  config: {
    accessToken: secret('HUBSPOT_ACCESS_TOKEN'),
    // resources: ['contacts', 'deals', 'deal_events'], // optional, defaults to all
  },
};
```

Register the connector class when mounting the engine:

```ts
import { HubSpotConnector } from '@rawdash/connector-hubspot';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, { connectorRegistry: { hubspot: HubSpotConnector } });
```

### Choosing resources

By default the connector syncs every supported resource. To sync only a subset, pass `resources` with any combination of:

`contacts`, `companies`, `deals`, `deal_events`, `email_campaigns`, `email_stats`

The access token only needs read scopes for the resources you list, and picking only what you need reduces API calls during full syncs.

### Example dashboard

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [hubspot],
  dashboards: {
    sales: defineDashboard({
      widgets: {
        open_deal_value: {
          kind: 'stat',
          title: 'Open deal value',
          metric: defineMetric({
            connector: hubspot,
            shape: 'entity',
            entityType: 'hubspot_deal',
            field: 'amount',
            fn: 'sum',
            filter: [{ field: 'dealStage', op: 'neq', value: 'closedlost' }],
          }),
        },
        open_deals: {
          kind: 'stat',
          title: 'Open deals',
          metric: defineMetric({
            connector: hubspot,
            shape: 'entity',
            entityType: 'hubspot_deal',
            fn: 'count',
            filter: [
              { field: 'dealstage', op: 'eq', value: 'appointmentscheduled' },
            ],
          }),
        },
        contacts_by_lifecycle: {
          kind: 'distribution',
          title: 'Contacts by lifecycle stage',
          metric: defineMetric({
            connector: hubspot,
            shape: 'entity',
            entityType: 'hubspot_contact',
            fn: 'count',
            groupBy: { field: 'lifecycleStage' },
          }),
        },
        email_opens: {
          kind: 'timeseries',
          title: 'Email opens per campaign',
          window: '90d',
          metric: defineMetric({
            connector: hubspot,
            shape: 'metric',
            name: 'hubspot_email_stats',
            field: 'opened',
            fn: 'sum',
            window: '90d',
            groupBy: { field: 'ts', granularity: 'day' },
          }),
        },
      },
    }),
  },
});
```

## Data model

Monetary amounts (deal `amount`) are in the account's currency, as returned by HubSpot. Timestamps stored in attributes are Unix milliseconds.

| Storage shape | Entity/event/metric type    | Key attributes                                                                    |
| ------------- | --------------------------- | --------------------------------------------------------------------------------- |
| entity        | `hubspot_contact`           | email, lifecycleStage, leadStatus, ownerId, createdAt                             |
| entity        | `hubspot_company`           | name, domain, industry, lifecycleStage, createdAt                                 |
| entity        | `hubspot_deal`              | dealName, dealStage, pipeline, amount, closeDate, ownerId, createdAt              |
| event         | `hubspot_deal_stage_change` | dealId, stage, sourceType                                                         |
| entity        | `hubspot_email_campaign`    | name, subject, fromName, type, sentDate, numIncluded                              |
| metric        | `hubspot_email_stats`       | campaignId, campaignName, sent, delivered, opened, clicked, bounced, unsubscribed |

- **`hubspot_deal_stage_change`** events come from the `dealstage` property history on each deal (`propertiesWithHistory=dealstage`). One event per recorded stage value, timestamped at the moment the stage was set.
- **`hubspot_email_stats`** metrics carry one sample per campaign; `value` is the `sent` count and every counter is also exposed in `attributes` so timeseries / distribution widgets can chart any of them.

## Schemas

`HubSpotConnector.schemas` declares the Zod schema for each resource's raw API response (the array of records for CRM resources, the deal-history record array, and the campaign-detail object array). Used by the cloud shape-drift pipeline to populate `connector_baselines`, and by the package's property tests.

## Sync behaviour

- **Backfill** (`mode: 'full'`): CRM objects are fetched via the Search API (`POST /crm/v3/objects/{object}/search`) sorted by last-modified ascending, paginated with the `after` cursor; deal events and email data are enumerated and rewritten in full.
- **Incremental** (`mode: 'latest'`): CRM searches add a `filterGroups` `GTE` filter on the object's last-modified property so only changed records are fetched. Entity phases upsert (no clear); the event and metric phases rewrite their requested window each run.
- **Resumable**: each phase yields an `after`/offset cursor on abort, so an interrupted sync resumes from the same page.
- **Rate limits**: HubSpot returns `429` when the per-app limit (100 requests / 10s) is exceeded. The shared HTTP client retries automatically with exponential back-off and honors `Retry-After`.

> **Search API ceiling:** HubSpot's Search API caps results at 10,000 per query. Very large CRM portfolios may not backfill in full in a single window; incremental syncs (which filter on `hs_lastmodifieddate`) stay well under the ceiling.

## Aggregates

| Function | Resource          | Upstream call                                                |
| -------- | ----------------- | ------------------------------------------------------------ |
| `count`  | `hubspot_contact` | `POST /crm/v3/objects/contacts/search` (`limit=1`, `total`)  |
| `count`  | `hubspot_company` | `POST /crm/v3/objects/companies/search` (`limit=1`, `total`) |
| `count`  | `hubspot_deal`    | `POST /crm/v3/objects/deals/search` (`limit=1`, `total`)     |

`count` widgets are served directly from the Search API `total`, so the runner can skip backfilling the underlying entities for that tick. Filter conditions translate to HubSpot search operators (`eq→EQ`, `neq→NEQ`, `gt→GT`, `gte→GTE`, `lt→LT`, `lte→LTE`, `contains→CONTAINS_TOKEN`). `OR` clauses and `latest` aggregates aren't supported and fall back to evaluating against synced storage rows.

## Registering in the MCP server

To make the connector available via the `add_connector` MCP tool, include it in `connectorFactories`:

```ts
import { HubSpotConnector, configFields } from '@rawdash/connector-hubspot';

createMcpServer({
  // ...
  connectorFactories: [
    {
      id: 'hubspot',
      configFields,
      create: HubSpotConnector.create,
    },
  ],
});
```

## Property tests

The CRM entity resources (`contacts`, `companies`, `deals`) have fast-check property tests under `src/property.test.ts` that generate synthetic API payloads from each resource's Zod schema, run them through `connector.sync()` against an `InMemoryStorage`, and assert universal invariants (non-empty ids, finite timestamps, no `undefined` in storage, no thrown errors) plus per-resource entity counts. Deal events, email campaigns, and email stats are covered by example-driven unit tests in `src/hubspot.test.ts`.
