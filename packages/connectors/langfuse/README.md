<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-langfuse

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-langfuse)](https://www.npmjs.com/package/@rawdash/connector-langfuse)
[![license](https://img.shields.io/npm/l/@rawdash/connector-langfuse)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync LLM traces, daily observation volume and cost by model, and feedback scores from a Langfuse project.

## Install

```sh
npm install @rawdash/connector-langfuse
```

## Authentication

A Langfuse public + secret API key pair scoped to one project is required. The connector authenticates over HTTP Basic auth (`publicKey:secretKey`).

1. Open Langfuse -> Settings -> API Keys and create a new key pair for the project you want to sync.
2. Copy both the public key (`pk-lf-...`) and the secret key (`sk-lf-...`). The secret is shown once.
3. Set `host` to your instance base URL - `https://cloud.langfuse.com` (or the US/EU regional variants) for Langfuse Cloud, or your self-hosted origin (no trailing slash).
4. Store the secret as a secret and reference it from config as `secretKey: secret("LANGFUSE_SECRET_KEY")`, alongside the plaintext `publicKey`.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                                                         |
| -------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicKey`    | string | Yes      | Langfuse public API key for the project (starts with `pk-lf-`). Created in Langfuse -> Settings -> API Keys.                                                                                        |
| `secretKey`    | secret | Yes      | Langfuse secret API key for the project (starts with `sk-lf-`). Issued alongside the public key in Langfuse -> Settings -> API Keys.                                                                |
| `host`         | string | No       | Langfuse instance base URL. Use https://cloud.langfuse.com (US) or https://us.cloud.langfuse.com / https://eu.cloud.langfuse.com for Langfuse Cloud, or your self-hosted origin. No trailing slash. |
| `lookbackDays` | number | No       | How many calendar days of history to backfill on a full sync. Defaults to 30.                                                                                                                       |
| `resources`    | array  | No       | Which Langfuse resources to sync. Omit to sync all of them.                                                                                                                                         |

## Resources

- **`langfuse_trace`** _(entity)_ - LLM traces in the project, keyed by id, with name, owning user/session, optional release/version, aggregate cost in USD, aggregate latency in milliseconds, and the createdAt timestamp.
  - Endpoint: `GET /api/public/traces`
  - Traces upsert by id on every run. Trace input/output payloads are not stored.
  - `name`: Trace name set by the SDK.
  - `projectId`: Langfuse project id the trace belongs to.
  - `userId`: Attached userId, if any.
  - `sessionId`: Attached sessionId, if any.
  - `release`: Release identifier from the SDK, if set.
  - `version`: Version identifier from the SDK, if set.
  - `totalCost`: Aggregate trace cost in USD across all observations.
  - `latencyMs`: End-to-end trace latency in milliseconds.
  - `createdAt`: ISO timestamp of trace creation.
- **`langfuse_observations_per_day`** _(metric)_ - Daily LLM observation volume, total tokens, and total cost rolled up by model from the Langfuse daily metrics endpoint. One sample per (day, model) over the lookback window.
  - Endpoint: `GET /api/public/metrics/daily`
  - Unit: observations
  - Granularity: Daily (UTC)
  - Dimensions: `model`, `countObservations`, `inputTokens`, `outputTokens`, `totalTokens`, `costUsd`
  - Rollup metrics are stamped at UTC midnight of the day they cover.
- **`langfuse_scores`** _(metric)_ - Daily Langfuse score rollups by score name. One sample per (day, name): the mean numeric value across that day and the count of scores written.
  - Endpoint: `GET /api/public/scores`
  - Unit: scores
  - Granularity: Daily (UTC)
  - Dimensions: `name`, `average`, `count`
  - Only numeric scores contribute to the average; non-numeric scores still increment the count.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const langfuse = {
  name: 'langfuse',
  connectorId: 'langfuse',
  config: {
    publicKey: 'pk-lf-...',
    secretKey: secret('LANGFUSE_SECRET_KEY'),
    host: 'https://cloud.langfuse.com',
  },
};

export default defineConfig({
  connectors: [langfuse],
  dashboards: {
    llm: defineDashboard({
      widgets: {
        daily_observations: {
          kind: 'timeseries',
          title: 'LLM observations per day',
          window: '30d',
          metric: defineMetric({
            connector: langfuse,
            shape: 'metric',
            name: 'langfuse_observations_per_day',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Langfuse Cloud applies per-project rate limits (around 1000 requests/min on paid plans); 429 responses with Retry-After are honored.

## Limitations

- One key pair scopes the sync to a single Langfuse project; sync multiple projects by adding one connector instance per project.
- Trace bodies (input/output payloads) are not synced - only the trace envelope plus aggregated cost / token / latency.
- Session and dataset endpoints are out of scope for the initial release.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Langfuse API docs](https://api.reference.langfuse.com)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
