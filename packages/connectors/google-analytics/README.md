# @rawdash/connector-google-analytics

Rawdash connector for Google Analytics 4 — syncs traffic, source/medium attribution, top pages, events, conversions, and geo data via the [GA4 Data API](https://developers.google.com/analytics/devguides/reporting/data/v1).

## Auth setup

The connector supports two authentication methods. **Service account JSON** is recommended for server-side use.

### Option A — Service account (recommended)

1. Open [Google Cloud Console](https://console.cloud.google.com) and select (or create) your project.
2. Navigate to **IAM & Admin → Service Accounts** and click **Create Service Account**.
3. Give it a name (e.g. `rawdash-ga4-reader`) and click **Create and continue**.
4. Skip the optional role assignment on this screen — click **Done**.
5. In Google Analytics, go to **Admin → Account Access Management** and add the service account email with the **Viewer** role.
6. Back in Cloud Console, open the service account → **Keys** → **Add key → Create new key → JSON**.
7. Download the `.json` file and store its contents as the secret `GA_SERVICE_ACCOUNT_JSON`.

### Option B — OAuth refresh token

1. Create an OAuth 2.0 client ID in [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials → Create Credentials → OAuth client ID** (type: Web application).
2. Run the OAuth consent flow with scope `https://www.googleapis.com/auth/analytics.readonly`.
3. Exchange the authorization code for a refresh token using the token endpoint.
4. Store the refresh token as `GA_REFRESH_TOKEN`, the client ID as `GA_CLIENT_ID`, and the client secret as `GA_CLIENT_SECRET`.

## Configuration

Service account auth:

```ts
import { secret } from '@rawdash/core';

const ga4 = {
  name: 'ga4',
  connectorId: 'google-analytics',
  config: {
    propertyId: '123456789',
    serviceAccountJson: secret('GA_SERVICE_ACCOUNT_JSON'),
  },
};
```

OAuth auth:

```ts
import { secret } from '@rawdash/core';

const ga4 = {
  name: 'ga4',
  connectorId: 'google-analytics',
  config: {
    propertyId: '123456789',
    refreshToken: secret('GA_REFRESH_TOKEN'),
    clientId: process.env['GA_CLIENT_ID']!,
    clientSecret: secret('GA_CLIENT_SECRET'),
  },
};
```

Register the connector class when mounting the engine:

```ts
import { GA4Connector } from '@rawdash/connector-google-analytics';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, {
  connectorRegistry: { 'google-analytics': GA4Connector },
});
```

Then wire it into `defineConfig`:

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [ga4],
  dashboards: {
    marketing: defineDashboard({
      widgets: {
        sessions_today: {
          kind: 'stat',
          title: 'Sessions today',
          metric: defineMetric({
            connector: ga4,
            shape: 'metric',
            name: 'ga4_traffic_by_day',
            field: 'sessions',
            fn: 'sum',
            window: '1d',
          }),
        },
        sessions_over_time: {
          kind: 'timeseries',
          title: 'Sessions over time',
          window: '30d',
          metric: defineMetric({
            connector: ga4,
            shape: 'metric',
            name: 'ga4_traffic_by_day',
            field: 'sessions',
            fn: 'sum',
            window: '30d',
            groupBy: { field: 'ts', granularity: 'day' },
          }),
        },
        traffic_by_source: {
          kind: 'distribution',
          title: 'Traffic by source',
          metric: defineMetric({
            connector: ga4,
            shape: 'metric',
            name: 'ga4_traffic_by_source',
            field: 'sessions',
            fn: 'sum',
            window: '30d',
          }),
        },
      },
    }),
  },
});
```

## Data model

All resources are stored as **metric samples** (`shape: 'metric'`). The `ts` field is the date in Unix milliseconds. All GA4 dimensions and metrics are available as attributes on each sample.

| Metric name             | Dimensions                         | Metrics (attributes)                                            |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------- |
| `ga4_traffic_by_day`    | date                               | sessions, totalUsers, newUsers, screenPageViews, engagementRate |
| `ga4_traffic_by_source` | date, sessionSource, sessionMedium | sessions, conversions                                           |
| `ga4_top_pages`         | date, pagePath                     | screenPageViews, averageSessionDuration                         |
| `ga4_events`            | date, eventName                    | eventCount, totalUsers                                          |
| `ga4_conversions`       | date, eventName                    | conversions, totalRevenue                                       |
| `ga4_geo`               | date, country                      | sessions, totalUsers                                            |

The `value` field of each metric sample contains the first metric in the table above (e.g. `sessions` for `ga4_traffic_by_day`). All other metrics are accessible via attribute names.

## Sync behaviour

- **Backfill** (`mode: 'full'`): fetches a rolling window (default 90 days, configurable via `lookbackDays`) for all six resources.
- **Incremental** (`mode: 'latest'`): fetches the trailing 30 days to catch late-arriving attribution data (GA4 can attribute conversions up to 3 days after the session).
- Both modes **clear existing metric data** for each resource before re-inserting, preventing duplicate rows from accumulating across sync runs.
- **Pagination**: uses the GA4 Data API `offset`/`limit` model with 10 000 rows per page. Interrupted syncs return a cursor and resume from the same phase and offset.
- **Rate limits**: the GA4 Data API quota is 200 000 tokens/day per property (default). 429 responses are handled automatically by the built-in HTTP client with exponential back-off.

## Registering in the MCP server

```ts
import {
  GA4Connector,
  configFields,
} from '@rawdash/connector-google-analytics';

createMcpServer({
  // ...
  connectorFactories: [
    {
      id: 'google-analytics',
      configFields,
      create: GA4Connector.create,
    },
  ],
});
```

## Property tests

Resources in this connector have fast-check property tests under `src/property.test.ts` that:

1. Generate N≥50 synthetic API payloads from a Zod schema mirroring the upstream API response.
2. Pipe them through `connector.sync()` against an `InMemoryStorage` instance.
3. Assert universal invariants — non-empty entity ids, finite event timestamps, no `undefined` leaking into storage, no thrown errors on any valid input — plus per-resource counts.

The helper lives in `@rawdash/connector-test-utils`. When adding a new resource, add a Zod schema for its payload and a test wired up via `runPropertySyncTest`.
