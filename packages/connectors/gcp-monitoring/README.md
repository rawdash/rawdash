<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-gcp-monitoring

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-gcp-monitoring)](https://www.npmjs.com/package/@rawdash/connector-gcp-monitoring)
[![license](https://img.shields.io/npm/l/@rawdash/connector-gcp-monitoring)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Pull declared Cloud Monitoring metric time series (any metric type, aligner, and period) into a single metric series per query.

## Install

```sh
npm install @rawdash/connector-gcp-monitoring
```

## Authentication

Authenticate against the Cloud Monitoring v3 API with a Google service account JSON key. The service account needs the Monitoring Viewer role (roles/monitoring.viewer) on the project whose metrics it reads.

1. Identify the GCP project whose metrics you want to sync.
2. Create a service account at Google Cloud -> IAM & Admin -> Service Accounts in that project (or grant an existing one access).
3. Grant the service account the Monitoring Viewer role (roles/monitoring.viewer) on the project. The API enables this role automatically for owners and editors.
4. Generate a JSON key for the service account and store its contents as a secret (e.g. GCP_MONITORING_SA_JSON).
5. Reference the key from config as serviceAccountJson: secret("GCP_MONITORING_SA_JSON") and set projectId to the same project.

## Configuration

| Field                | Type   | Required | Description                                                                                                                                                                                                                               |
| -------------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`          | string | Yes      | Google Cloud project ID whose metrics should be synced (the project that owns the monitored resources).                                                                                                                                   |
| `serviceAccountJson` | secret | Yes      | Contents of the JSON key file for a Google service account with the role required by this connector. Create one at Google Cloud -> IAM & Admin -> Service Accounts and store the JSON as a secret.                                        |
| `metricQueries`      | array  | Yes      | Cloud Monitoring is too broad to mirror wholesale; declare the specific metrics to pull. Each query needs an id, metric type, alignment period (e.g. 300s), and a perSeriesAligner statistic, with an optional filter on resource labels. |
| `lookbackMinutes`    | number | No       | How far back to pull data points on a full sync when the host does not supply a since bound. Defaults to 180.                                                                                                                             |

## Resources

- **`<metricType>`** _(metric)_ - One metric series per declared metric query. The series name is the configured metric type (e.g. `compute.googleapis.com/instance/cpu/utilization`), so the actual keys depend on the configured `metricQueries`. Each sample carries the aligner, alignment period, query id, and metric/resource labels as attributes.
  - Endpoint: `GET /v3/projects/{projectId}/timeSeries`
  - Granularity: Per alignmentPeriod (a duration in seconds, e.g. 300s)
  - Dimensions: `perSeriesAligner`, `alignmentPeriod`, `queryId`, `resourceType`
  - Each sync replaces the full set of samples for the metric names it owns (idempotent). Distribution-valued points are dropped unless reduced to a scalar by the perSeriesAligner.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const gcpMonitoring = {
  name: 'gcpMonitoring',
  connectorId: 'gcp-monitoring',
  config: {
    projectId: 'my-project-123',
    serviceAccountJson: secret('GCP_MONITORING_SA_JSON'),
    metricQueries: [
      {
        id: 'gce_cpu',
        metricType: 'compute.googleapis.com/instance/cpu/utilization',
        alignmentPeriod: '300s',
        perSeriesAligner: 'ALIGN_MEAN',
      },
    ],
    lookbackMinutes: 180,
  },
};

export default defineConfig({
  connectors: [gcpMonitoring],
  dashboards: {
    infra: defineDashboard({
      widgets: {
        cpu: {
          kind: 'timeseries',
          title: 'GCE CPU utilization',
          window: '24h',
          metric: defineMetric({
            connector: gcpMonitoring,
            shape: 'metric',
            name: 'compute.googleapis.com/instance/cpu/utilization',
            fn: 'avg',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Cloud Monitoring projects.timeSeries.list is rate-limited per project; 429 / RESOURCE_EXHAUSTED responses are retried with backoff. Pagination uses nextPageToken.

## Limitations

- Cloud Monitoring is too broad to mirror wholesale; only the metrics declared in metricQueries are synced; there is no automatic metric discovery.
- The series name is derived from the metric type, so two queries against the same metricType with different aligners or filters share one series name and are distinguished only by sample attributes.
- Each query alignmentPeriod must be expressed as a duration in seconds, e.g. 60s or 300s.
- A full sync uses lookbackMinutes; a latest sync uses a short window covering the last few alignment periods.
- Distribution-valued metrics (e.g. latency histograms) require a perSeriesAligner that reduces them to a scalar (ALIGN_PERCENTILE_99, ALIGN_MEAN, etc.); raw distributions are not stored.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Google Cloud API docs](https://cloud.google.com/monitoring/api/v3)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
