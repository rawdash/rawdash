<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-gcp-billing

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-gcp-billing)](https://www.npmjs.com/package/@rawdash/connector-gcp-billing)
[![license](https://img.shields.io/npm/l/@rawdash/connector-gcp-billing)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Track Google Cloud spend over time from the Cloud Billing -> BigQuery export, optionally broken down by service, project, SKU, or location.

> **Cost & frequency.** Each BigQuery query is billed against the bqProject. Prefer once-a-day syncs and a focused groupBy. Recommended sync interval: **1 day**. Minimum sensible interval: **1 hour**. Each sync costs roughly: 1 BigQuery query over the gcp*billing_export_v1*\* table family.

## Install

```sh
npm install @rawdash/connector-gcp-billing
```

## Authentication

Authenticate against the BigQuery API with a Google service account JSON key. The service account needs the BigQuery Data Viewer role on the billing-export dataset and the BigQuery Job User role on the project that runs the queries.

1. Enable the Cloud Billing -> BigQuery export in the GCP console (Billing -> Billing export -> BigQuery export). This is a manual one-time setup; data starts flowing into the configured dataset within a day.
2. Create a service account at Google Cloud -> IAM & Admin -> Service Accounts (or grant an existing one access).
3. Grant the service account roles/bigquery.dataViewer on the billing dataset (so it can read the export tables) and roles/bigquery.jobUser on the bqProject (so it can run query jobs).
4. Generate a JSON key for the service account and store its contents as a secret (e.g. GCP_BILLING_SA_JSON).
5. Reference the key from config as serviceAccountJson: secret("GCP_BILLING_SA_JSON") and set bqProject + bqDataset to the export location.

## Configuration

| Field                | Type   | Required | Description                                                                                                                                                                                        |
| -------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serviceAccountJson` | secret | Yes      | Contents of the JSON key file for a Google service account with the role required by this connector. Create one at Google Cloud -> IAM & Admin -> Service Accounts and store the JSON as a secret. |
| `bqProject`          | string | Yes      | Project that hosts the BigQuery billing-export dataset (also the project used to bill the BigQuery queries this connector runs).                                                                   |
| `bqDataset`          | string | Yes      | BigQuery dataset containing the Cloud Billing export tables (gcp*billing_export_v1*\*).                                                                                                            |
| `bqLocation`         | string | No       | Region or multi-region of the billing dataset (e.g. US, EU, us-central1). Defaults to US.                                                                                                          |
| `groupBy`            | array  | No       | Dimensions to break daily costs down by. Pick from service, project, sku, location. Defaults to ["service"].                                                                                       |
| `lookbackDays`       | number | No       | How many days of history to query on a full sync. Defaults to 90.                                                                                                                                  |

## Resources

- **`gcp_cost_daily`** _(metric)_ - Historical GCP cost per day, summed over the dimensions in `groupBy`. One sample per (date, dimension tuple). Pulls from the gcp*billing_export_v1*\* tables in BigQuery.
  - Endpoint: `POST /bigquery/v2/projects/{bqProject}/queries`
  - Unit: USD
  - Granularity: daily
  - Dimensions: `service`, `project`, `sku`, `location`, `currency`
  - BigQuery charges per query; prefer narrow groupBy and reasonable lookbackDays. The trailing 5 days are always refetched on incremental syncs to pick up back-revisions.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const gcpBilling = {
  name: 'gcpBilling',
  connectorId: 'gcp-billing',
  config: {
    serviceAccountJson: secret('GCP_BILLING_SA_JSON'),
    bqProject: 'my-billing-project',
    bqDataset: 'billing_export',
    bqLocation: 'US',
    groupBy: ['service'],
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [gcpBilling],
  dashboards: {
    finance: defineDashboard({
      widgets: {
        spend: {
          kind: 'stat',
          title: 'Spend (last 30d)',
          metric: defineMetric({
            connector: gcpBilling,
            shape: 'metric',
            name: 'gcp_cost_daily',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

BigQuery jobs.query is rate-limited per project; standard 429 / RESOURCE_EXHAUSTED responses are retried with backoff. Each connector sync runs one query (or a small number when paginated).

## Limitations

- Requires the Cloud Billing -> BigQuery export to be configured in the GCP console; that step is manual and one-time, and only days after the configuration date are present in the export.
- Queries the gcp*billing_export_v1*_ table family (standard usage cost export). The detailed resource-level export (gcp*billing_export_resource_v1*_) is not used.
- Each BigQuery query is billed against the bqProject; over long windows or wide groupBy axes the cost adds up. Prefer narrow groupBy and reasonable lookbackDays.
- Cost data is back-revised by GCP for several days; an incremental sync refetches the trailing 5 days to pick up corrections.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Google Cloud API docs](https://cloud.google.com/billing/docs/how-to/export-data-bigquery)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
