<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-vertex-ai

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-vertex-ai)](https://www.npmjs.com/package/@rawdash/connector-vertex-ai)
[![license](https://img.shields.io/npm/l/@rawdash/connector-vertex-ai)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync daily Vertex AI model invocations, token counts, errors, and spend (Gemini and partner models) into a single dashboard view of GCP AI usage.

> **Cost & frequency.** Each BigQuery spend query is billed against the bqProject. Prefer once-a-day syncs unless you need fresher invocation counts. Recommended sync interval: **1 day**. Minimum sensible interval: **1 hour**. Each sync costs roughly: 2 Cloud Monitoring requests, plus 1 BigQuery query when bqProject/bqDataset are set.

## Install

```sh
npm install @rawdash/connector-vertex-ai
```

## Authentication

Authenticate against the Cloud Monitoring v3 API (and optionally BigQuery for spend) with a Google service account JSON key. The service account needs the Monitoring Viewer role on the project running Vertex AI. To sync spend, it additionally needs BigQuery Data Viewer on the billing dataset and BigQuery Job User on the billing project.

1. Identify the GCP project running Vertex AI (it owns the publisher/online_serving metrics).
2. Create a service account at Google Cloud -> IAM & Admin -> Service Accounts in that project (or grant an existing one access).
3. Grant the service account the Monitoring Viewer role (roles/monitoring.viewer) on the project so it can read Vertex AI metrics.
4. To sync spend, enable the Cloud Billing -> BigQuery export (Billing -> Billing export -> BigQuery export). Then grant the service account roles/bigquery.dataViewer on the export dataset and roles/bigquery.jobUser on the bqProject.
5. Generate a JSON key for the service account and store its contents as a secret (e.g. GCP_SA_JSON).
6. Reference the key from config as serviceAccountJson: secret("GCP_SA_JSON") and set projectId to the Vertex AI project. Set bqProject / bqDataset to enable the spend resource.

## Configuration

| Field                | Type   | Required | Description                                                                                                                                                                                        |
| -------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`          | string | Yes      | Google Cloud project ID that hosts the Vertex AI workload. Cloud Monitoring metrics are read from this project.                                                                                    |
| `serviceAccountJson` | secret | Yes      | Contents of the JSON key file for a Google service account with the role required by this connector. Create one at Google Cloud -> IAM & Admin -> Service Accounts and store the JSON as a secret. |
| `bqProject`          | string | No       | Project that hosts the Cloud Billing -> BigQuery export. Required to sync the spend resource; omit to disable spend syncing.                                                                       |
| `bqDataset`          | string | No       | BigQuery dataset containing the Cloud Billing export tables (gcp*billing_export_v1*\*). Required to sync the spend resource.                                                                       |
| `bqLocation`         | string | No       | Region or multi-region of the billing dataset (e.g. US, EU, us-central1). Defaults to US when bqDataset is set.                                                                                    |
| `spendServiceFilter` | string | No       | BigQuery LIKE pattern matched against service.description to scope spend rows to Vertex AI. Defaults to "Vertex AI%" which covers both "Vertex AI" and "Vertex AI Generative AI" services.         |
| `lookbackDays`       | number | No       | How many days of history to pull on a full sync. Defaults to 30.                                                                                                                                   |

## Resources

- **`vertex_ai_invocations`** _(metric)_ - Daily count of successful Vertex AI model invocations (HTTP 2xx) per (date, modelId). Sourced from the Cloud Monitoring metric `aiplatform.googleapis.com/publisher/online_serving/model_invocation_count`, aggregated to one sample per day with SUM.
  - Endpoint: `GET /v3/projects/{projectId}/timeSeries`
  - Granularity: daily
  - Dimensions: `modelId`, `responseCode`
  - On every sync the trailing `lookbackDays` window is rewritten idempotently. Non-2xx response codes flow to `vertex_ai_errors` instead.
- **`vertex_ai_errors`** _(metric)_ - Daily count of failed Vertex AI model invocations (non-2xx) per (date, modelId, errorType). Sourced from the same Cloud Monitoring API call as `vertex_ai_invocations`; rows with response_code outside 200-299 are routed here.
  - Endpoint: `GET /v3/projects/{projectId}/timeSeries (shared with vertex_ai_invocations)`
  - Granularity: daily
  - Dimensions: `modelId`, `errorType`
  - errorType carries the upstream HTTP status (e.g. 400, 429, 500). Use it to slice quota errors (429) from request errors (4xx) and platform errors (5xx). The response schema is registered under `vertex_ai_invocations`.
- **`vertex_ai_tokens`** _(metric)_ - Daily Vertex AI token usage per (date, modelId, tokenType). Sourced from the Cloud Monitoring metric `aiplatform.googleapis.com/publisher/online_serving/token_count`. tokenType is either `input` (prompt) or `output` (completion).
  - Endpoint: `GET /v3/projects/{projectId}/timeSeries`
  - Granularity: daily
  - Dimensions: `modelId`, `tokenType`
  - Sum across both tokenType values to get total tokens; slice by tokenType to separate input from output cost drivers.
- **`vertex_ai_spend`** _(metric)_ - Daily Vertex AI spend per (date, sku) sourced from the Cloud Billing -> BigQuery export. Skipped unless bqProject and bqDataset are configured.
  - Endpoint: `POST /bigquery/v2/projects/{bqProject}/queries`
  - Unit: USD
  - Granularity: daily
  - Dimensions: `sku`, `service`, `currency`
  - The trailing 5 days are always refetched on incremental syncs to pick up GCP back-revisions. SKU describes the specific Vertex AI model and token type (e.g. "Gemini 1.5 Pro Online Inference - Input").

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const vertexAi = {
  name: 'vertexAi',
  connectorId: 'vertex-ai',
  config: {
    projectId: 'my-project-123',
    serviceAccountJson: secret('GCP_SA_JSON'),
    bqProject: 'my-billing-project',
    bqDataset: 'billing_export',
    bqLocation: 'US',
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [vertexAi],
  dashboards: {
    ai: defineDashboard({
      widgets: {
        invocations: {
          kind: 'stat',
          title: 'Invocations (24h)',
          metric: defineMetric({
            connector: vertexAi,
            shape: 'metric',
            name: 'vertex_ai_invocations',
            fn: 'sum',
          }),
        },
        spend: {
          kind: 'timeseries',
          title: 'Vertex AI spend',
          window: '30d',
          metric: defineMetric({
            connector: vertexAi,
            shape: 'metric',
            name: 'vertex_ai_spend',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Cloud Monitoring projects.timeSeries.list and BigQuery jobs.query are rate-limited per project; 429 / RESOURCE_EXHAUSTED responses are retried with backoff. Each sync issues at most three requests (invocations metric, tokens metric, optional BigQuery query).

## Limitations

- Only the publisher (Gemini and partner online-serving) metric family is synced. Custom model deployments under aiplatform.googleapis.com/prediction/\* are out of scope; query Cloud Monitoring directly via the gcp-monitoring connector if you need them.
- Spend rows come from the Cloud Billing -> BigQuery export; the export must be configured manually in the GCP console and only days after the configuration date are present.
- BigQuery cost rows are back-revised by GCP for several days; an incremental sync refetches a short trailing window to pick up corrections.
- Each BigQuery query is billed against the bqProject; keep lookbackDays reasonable.
- Daily aggregation only - sub-day granularity is intentionally not exposed for spend or invocation rollups.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Google Cloud API docs](https://cloud.google.com/vertex-ai/docs/general/monitoring)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
