<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-langsmith

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-langsmith)](https://www.npmjs.com/package/@rawdash/connector-langsmith)
[![license](https://img.shields.io/npm/l/@rawdash/connector-langsmith)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync LangChain runs, daily run rollups (count, tokens, cost, latency), and feedback scores from a LangSmith tenant.

## Install

```sh
npm install @rawdash/connector-langsmith
```

## Authentication

A LangSmith API key with read access is required. The key is sent as the `x-api-key` header on every request.

1. Open LangSmith -> Settings -> API Keys and create a Personal Access Token (or Service key) with read access.
2. Copy the key (it is shown once).
3. Set `endpoint` to your LangSmith region: https://api.smith.langchain.com (US, default), https://eu.api.smith.langchain.com (EU), or your self-hosted origin (no trailing slash).
4. Store the API key as a secret and reference it from config as `apiKey: secret("LANGSMITH_API_KEY")`.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                                             |
| -------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`       | secret | Yes      | LangSmith API key with read access to the tenant. Create one in LangSmith -> Settings -> API Keys.                                                                                      |
| `endpoint`     | string | No       | LangSmith API base URL. Defaults to https://api.smith.langchain.com (US cloud). Use https://eu.api.smith.langchain.com for the EU region or your self-hosted origin. No trailing slash. |
| `lookbackDays` | number | No       | How many calendar days of history to backfill on a full sync. Defaults to 30.                                                                                                           |
| `resources`    | array  | No       | Which LangSmith resources to sync. Omit to sync all of them. Both `runs` and `runs_per_day` are produced from the same upstream query, so listing either pulls runs.                    |

## Resources

- **`langsmith_run`** _(entity)_ - LangSmith run rows, keyed by id, with name, owning session/project, parent run, run type, status, start/end timestamps, total/prompt/completion tokens, total/prompt/completion cost in USD, and end-to-end latency in milliseconds.
  - Endpoint: `POST /api/v1/runs/query`
  - Runs upsert by id on every run. Trace input/output payloads are not stored.
  - `name`: Run name set by the SDK.
  - `runType`: Run type (chain, tool, llm, embedding, parser, retriever).
  - `status`: Run status (success, error, pending).
  - `sessionId`: Owning session (project) id, if any.
  - `sessionName`: Owning session (project) name, if any.
  - `parentRunId`: Parent run id for nested runs.
  - `startTime`: ISO timestamp of run start.
  - `endTime`: ISO timestamp of run end, if completed.
  - `totalTokens`: Aggregate token count across the run.
  - `promptTokens`: Prompt token count for the run.
  - `completionTokens`: Completion token count for the run.
  - `totalCost`: Aggregate run cost in USD.
  - `latencyMs`: End-to-end latency in milliseconds.
  - `error`: Error message if the run failed.
- **`langsmith_runs_per_day`** _(metric)_ - Per-run samples used to roll runs up to daily totals at query time. One sample is emitted per run at its start timestamp, tagged with project, run type, and status. The sample value is 1 (so summing field:`value` yields the run count); token, cost, and latency are exposed as additional measures.
  - Endpoint: `POST /api/v1/runs/query`
  - Unit: runs
  - Granularity: Per-run (query-time rollup)
  - Dimensions: `sessionId`, `sessionName`, `runType`, `status`
  - Measures: `totalTokens`, `promptTokens`, `completionTokens`, `costUsd`, `latencyMs`
  - No server-side aggregation - widgets group by day, project, or run type to produce the rollup.
- **`langsmith_feedback`** _(metric)_ - Feedback rows from LangSmith, one sample per feedback row at its created_at timestamp. The sample value is the numeric score (zero for non-numeric feedback) and the measure `count` is 1 so summing it yields feedback counts per (day, project, key).
  - Endpoint: `GET /api/v1/feedback`
  - Unit: score
  - Granularity: Per-feedback (query-time rollup)
  - Dimensions: `key`, `sessionId`, `runId`
  - Measures: `count`, `hasNumericScore`
  - Non-numeric feedback (string, boolean, JSON value) is still emitted but with score 0; use `count` to count rows and average `score` for numeric trends.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const langsmith = {
  name: 'langsmith',
  connectorId: 'langsmith',
  config: {
    apiKey: secret('LANGSMITH_API_KEY'),
    endpoint: 'https://api.smith.langchain.com',
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [langsmith],
  dashboards: {
    llm_observability: defineDashboard({
      widgets: {
        runs_today: {
          kind: 'stat',
          title: 'Runs today',
          metric: defineMetric({
            connector: langsmith,
            shape: 'metric',
            name: 'langsmith_runs_per_day',
            fn: 'sum',
            field: 'value',
          }),
        },
        spend_today: {
          kind: 'stat',
          title: 'LLM spend today (USD)',
          metric: defineMetric({
            connector: langsmith,
            shape: 'metric',
            name: 'langsmith_runs_per_day',
            fn: 'sum',
            field: 'costUsd',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

LangSmith applies per-tenant rate limits and returns 429 with Retry-After on overrun; the shared HTTP client honors that header.

## Limitations

- Run input/output payloads are not synced - only the run envelope plus aggregated cost, token, and latency.
- Datasets, examples, prompts, and evaluation runs are out of scope for the initial release.
- Feedback non-numeric values (string, boolean, JSON) are still counted but do not contribute to the score sample.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [LangSmith API docs](https://docs.smith.langchain.com/reference)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
