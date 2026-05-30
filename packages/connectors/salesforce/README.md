# @rawdash/connector-salesforce

Rawdash connector for Salesforce — syncs opportunities, stage-change events, accounts, leads, and users into the six-shape storage model. Pipeline, forecast, and quota-attainment widgets are the canonical first sales dashboards.

## Auth setup

The connector authenticates with **OAuth 2.0** using a refresh token issued by a Salesforce Connected App.

1. In Salesforce, go to **Setup → App Manager → New Connected App**.
2. Fill in the basic info (name, contact email, etc.) and check **Enable OAuth Settings**.
3. Set the callback URL to a URL you control (e.g. `https://localhost:8080/callback`). It only has to be reachable when minting the initial refresh token.
4. Under **Selected OAuth Scopes**, add:
   - **Access and manage your data (api)**
   - **Perform requests on your behalf at any time (refresh_token, offline_access)**
5. Save. On the connected app's detail page, copy the **Consumer Key** (client ID) and **Consumer Secret**.
6. From a browser, hit `https://login.salesforce.com/services/oauth2/authorize?response_type=code&client_id=<KEY>&redirect_uri=<URL>` and authorize. Exchange the resulting `code` at `https://login.salesforce.com/services/oauth2/token` to get a refresh token and the org's `instance_url`.
7. Store the refresh token and consumer secret as rawdash secrets (`secret('SF_REFRESH_TOKEN')`, `secret('SF_CLIENT_SECRET')`).

> **Use the org's instance URL, not login.salesforce.com.** The token response carries the canonical `instance_url` (e.g. `https://mycompany.my.salesforce.com`). All subsequent REST and SOQL traffic must go through that URL.

## Configuration

```ts
import { secret } from '@rawdash/core';

const salesforce = {
  name: 'salesforce',
  connectorId: 'salesforce',
  config: {
    clientId: '3MVG9_consumerKey_...',
    clientSecret: secret('SF_CLIENT_SECRET'),
    refreshToken: secret('SF_REFRESH_TOKEN'),
    instanceUrl: 'https://mycompany.my.salesforce.com',
    // apiVersion: '59.0',                                 // optional
    // resources: ['opportunities', 'opportunity_events'], // optional, defaults to all
  },
};
```

Register the connector class when mounting the engine:

```ts
import { SalesforceConnector } from '@rawdash/connector-salesforce';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, { connectorRegistry: { salesforce: SalesforceConnector } });
```

### Choosing resources

By default the connector syncs every supported resource. To sync only a subset, pass `resources` with any combination of:

`users`, `accounts`, `leads`, `opportunities`, `opportunity_events`

The Connected App's OAuth scope only needs read access for the resources you list.

### Example dashboard

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [salesforce],
  dashboards: {
    sales: defineDashboard({
      widgets: {
        open_pipeline: {
          kind: 'stat',
          title: 'Open pipeline value',
          metric: defineMetric({
            connector: salesforce,
            shape: 'entity',
            entityType: 'salesforce_opportunity',
            field: 'amount',
            fn: 'sum',
            filter: [{ field: 'isClosed', op: 'eq', value: false }],
          }),
        },
        pipeline_by_stage: {
          kind: 'distribution',
          title: 'Pipeline by stage',
          metric: defineMetric({
            connector: salesforce,
            shape: 'entity',
            entityType: 'salesforce_opportunity',
            field: 'amount',
            fn: 'sum',
            groupBy: { field: 'stage' },
            filter: [{ field: 'isClosed', op: 'eq', value: false }],
          }),
        },
        bookings_per_week: {
          kind: 'timeseries',
          title: 'Bookings per week',
          window: '12w',
          metric: defineMetric({
            connector: salesforce,
            shape: 'entity',
            entityType: 'salesforce_opportunity',
            field: 'amount',
            fn: 'sum',
            window: '12w',
            filter: [{ field: 'isWon', op: 'eq', value: true }],
            groupBy: { field: 'closeDate', granularity: 'week' },
          }),
        },
      },
    }),
  },
});
```

## Data model

Monetary amounts (`amount`, `annualRevenue`) are in the org's currency. Timestamps stored in attributes are Unix milliseconds.

| Storage shape | Entity/event/metric type              | Key attributes                                                                                     |
| ------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| entity        | `salesforce_user`                     | name, email, isActive                                                                              |
| entity        | `salesforce_account`                  | name, industry, annualRevenue, ownerId, createdAt                                                  |
| entity        | `salesforce_lead`                     | email, status, source, convertedAt, createdAt                                                      |
| entity        | `salesforce_opportunity`              | name, stage, amount, closeDate, ownerId, probability, forecastCategory, isClosed, isWon, createdAt |
| event         | `salesforce_opportunity_stage_change` | historyId, opportunityId, fromStage, toStage, actorId                                              |

- **`salesforce_opportunity_stage_change`** events come from `OpportunityFieldHistory` rows where `Field = 'StageName'`. One event per stage transition, timestamped at `CreatedDate`.

## Schemas

`SalesforceConnector.schemas` declares the Zod schema for each resource's raw API response (`oauth_token` plus an array of records for each SOQL phase). Used by the cloud shape-drift pipeline to populate `connector_baselines`, and by the package's property tests.

## Sync behaviour

- **Backfill** (`mode: 'full'`): each resource is fetched via a SOQL query at `${instanceUrl}/services/data/v<version>/query`, sorted by `LastModifiedDate ASC` (`CreatedDate ASC` for `opportunity_events`), and paginated by following `nextRecordsUrl` on each response until `done: true`.
- **Incremental** (`mode: 'latest'`): the SOQL adds a `LastModifiedDate >= <since>` filter (`CreatedDate >= <since>` for `opportunity_events`). Entity phases upsert by `(type, id)`; the event phase only clears its scope on a full sync, so an incremental window does not drop history outside its range.
- **Resumable**: the cursor stores the `nextRecordsUrl` of the next unfetched page, so an interrupted sync resumes from the same Salesforce query locator.
- **Token refresh**: each `sync()` call mints a fresh access token by POSTing the refresh token to `${instanceUrl}/services/oauth2/token`, then reuses that token for every SOQL request in the run.
- **Rate limits**: Salesforce caps total API calls per org per 24 hours. Responses include a `Sforce-Limit-Info` header (`api-usage=NN/MM`); operators should size sync intervals so the daily budget isn't exhausted. The shared HTTP client retries automatically on 429 with `Retry-After`.

## Out of scope

- **Custom objects.** v1 covers the standard Salesforce objects listed above. Custom-object support can be added later.
- **Salesforce Marketing Cloud.** Tracked under a separate connector.

## Registering in the MCP server

To make the connector available via the `add_connector` MCP tool, include it in `connectorFactories`:

```ts
import {
  SalesforceConnector,
  configFields,
} from '@rawdash/connector-salesforce';

createMcpServer({
  // ...
  connectorFactories: [
    {
      id: 'salesforce',
      configFields,
      create: SalesforceConnector.create,
    },
  ],
});
```

## Property tests

The entity resources (`accounts`, `leads`, `opportunities`) and the `opportunity_events` phase have fast-check property tests under `src/property.test.ts` that generate synthetic SOQL responses from each resource's Zod schema, run them through `connector.sync()` against an `InMemoryStorage`, and assert universal invariants (non-empty ids, finite timestamps, no `undefined` in storage, no thrown errors) plus per-resource entity/event counts.
