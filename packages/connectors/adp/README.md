<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-adp

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-adp)](https://www.npmjs.com/package/@rawdash/connector-adp)
[![license](https://img.shields.io/npm/l/@rawdash/connector-adp)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync workers and per-cycle payroll output from ADP Workforce Now for headcount, payroll-spend, and pay-cycle trend dashboards.

> **Cost & frequency.** Workers are re-fetched in full on each sync and payroll output is walked over the lookback window, so a run can span many pages on large populations. ADP throttles per application, so syncing too often can exhaust the shared quota. Recommended sync interval: **12 hours**. Minimum sensible interval: **1 hour**.

## Install

```sh
npm install @rawdash/connector-adp
```

## Authentication

OAuth 2.0 client-credentials against the ADP token endpoint, over a mutual-TLS channel. ADP issues a client ID / secret plus a client certificate when you register a Workforce Now API application; the certificate authenticates the TLS connection to api.adp.com and the client credentials mint a short-lived bearer token for each call.

1. Register (or reuse) a Workforce Now API application in the ADP Marketplace / API Central to obtain a client ID and client secret.
2. Generate the mutual-TLS client certificate and private key ADP provisions for the application; download the certificate (PEM) and private key (PEM).
3. Grant the application read scopes for Worker Demographics / Worker Management and Payroll Output.
4. Store the client secret, certificate PEM, and private key PEM as secrets and reference them from config as `clientSecret: secret("ADP_CLIENT_SECRET")`, `certPem: secret("ADP_CERT_PEM")`, and `keyPem: secret("ADP_KEY_PEM")`.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                                                                  |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clientId`     | string | Yes      | OAuth 2.0 client ID issued to your ADP Workforce Now API application (ADP Marketplace / API Central).                                                                                                        |
| `clientSecret` | secret | Yes      | OAuth 2.0 client secret paired with the client ID. Stored as a secret.                                                                                                                                       |
| `certPem`      | secret | Yes      | PEM-encoded client certificate for the mutual-TLS channel ADP requires on api.adp.com. Provided to the runtime that terminates TLS; see the README for how mTLS is handled.                                  |
| `keyPem`       | secret | Yes      | PEM-encoded private key matching the client certificate. Stored as a secret and used by the runtime for the mTLS handshake.                                                                                  |
| `lookbackDays` | number | No       | How many days of payroll output to sync, filtered by pay date. Defaults to 365. Payroll is synced over a rolling window and rewritten on every sync, so pay cycles older than the window age out of storage. |
| `resources`    | array  | No       | Which ADP resources to sync. Omit to sync all of them. The payrolls resource writes both the per-cycle payroll entity and the derived payroll spend metric.                                                  |

## Resources

- **`adp_worker`** _(entity)_ - Workers from ADP Workforce Now with name, job title, business unit, employment status, hire date, and termination date. Re-fetched in full on every sync.
  - Endpoint: `GET /hr/v2/workers`
  - `name`: Worker legal name.
  - `jobTitle`: Job title on the primary work assignment.
  - `businessUnit`: Home organizational unit on the primary work assignment, used for headcount distributions.
  - `status`: Employment status (e.g. active / terminated / leave), lowercased from the worker status code.
  - `hireDate`: Hire date on the primary work assignment (Unix ms).
  - `terminationDate`: Termination date on the primary work assignment (Unix ms; null while active).
- **`adp_payroll`** _(entity)_ - Employer payroll output per pay group and pay date: gross pay, net pay, total taxes, and total deductions. Synced over a rolling pay-date window and rewritten on every sync.
  - Endpoint: `GET /payroll/v1/payroll-output`
  - `payGroup`: Pay group code for the pay cycle.
  - `businessUnit`: Organizational unit the pay cycle belongs to.
  - `grossPay`: Total gross pay for the cycle.
  - `netPay`: Total net pay for the cycle.
  - `taxes`: Total taxes withheld for the cycle.
  - `deductions`: Total deductions for the cycle.
  - `currency`: Currency code for the amounts.
  - `employeeCount`: Number of employees paid in the cycle.
  - `payDate`: Pay date of the cycle (Unix ms).
- **`adp_payroll_metric`** _(metric)_ - Payroll spend per pay cycle, one sample per amount kind (gross / net / taxes / deductions) with the business unit as a dimension. Derived from the payroll output, not a separate API call.
  - Endpoint: `GET /payroll/v1/payroll-output`
  - Unit: currency
  - Dimensions: `kind`, `businessUnit`
  - Derived from each payroll output record's amounts; the pay date is the sample timestamp. Pay cycles are irregular (weekly / bi-weekly / monthly), so no fixed granularity is declared.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const adp = {
  name: 'adp',
  connectorId: 'adp',
  config: {
    clientId: 'your-adp-client-id',
    clientSecret: secret('ADP_CLIENT_SECRET'),
    certPem: secret('ADP_CERT_PEM'),
    keyPem: secret('ADP_KEY_PEM'),
  },
};

export default defineConfig({
  connectors: [adp],
  dashboards: {
    workforce: defineDashboard({
      widgets: {
        headcount: {
          kind: 'stat',
          title: 'Active headcount',
          metric: defineMetric({
            connector: adp,
            shape: 'entity',
            entityType: 'adp_worker',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'active' }],
          }),
        },
        payroll_spend_30d: {
          kind: 'stat',
          title: 'Gross payroll (30d)',
          window: '30d',
          metric: defineMetric({
            connector: adp,
            shape: 'metric',
            name: 'adp_payroll_metric',
            fn: 'sum',
            filter: [{ field: 'kind', op: 'eq', value: 'gross' }],
          }),
        },
        payroll_trend: {
          kind: 'timeseries',
          title: 'Gross payroll per cycle',
          window: '365d',
          metric: defineMetric({
            connector: adp,
            shape: 'metric',
            name: 'adp_payroll_metric',
            fn: 'sum',
            filter: [{ field: 'kind', op: 'eq', value: 'gross' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

ADP enforces per-application throttling on the Workforce Now APIs and returns HTTP 429 when exceeded; the shared HTTP client retries 429 responses with exponential backoff. Keep the sync interval modest so a backfill does not exhaust the application quota.

## Limitations

- ADP requires mutual TLS on api.adp.com. The rawdash HTTP client is fetch-based and cannot present a client certificate itself, so the certificate and private key are surfaced as secrets for the runtime / egress proxy that terminates TLS. In an environment without mTLS termination the sync cannot reach ADP.
- The Worker endpoint has no reliable updated-since filter, so workers are re-fetched in full on every sync and the stored scope is rewritten each run.
- Payroll is read as employer per-pay-cycle output summaries (gross / net / taxes / deductions per pay group and pay date) over a rolling lookback window, not as per-worker pay statements. Individual pay-statement detail is out of scope for the v1 dashboard use case.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [ADP API docs](https://developers.adp.com/articles/api/wfn-api-explorer)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
