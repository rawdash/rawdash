<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-expensify

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-expensify)](https://www.npmjs.com/package/@rawdash/connector-expensify)
[![license](https://img.shields.io/npm/l/@rawdash/connector-expensify)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Expensify expense reports, individual expenses, and daily category spend for finance-ops dashboards: reports pending, month-to-date spend, and spend by category.

## Install

```sh
npm install @rawdash/connector-expensify
```

## Authentication

Expensify API partner credentials (partnerUserID + partnerUserSecret). Both are sent in the credentials block of every Integration Server request over HTTPS.

1. In the Expensify web app, open Settings → Account → API and generate a partnerUserID / partnerUserSecret credential pair.
2. Set the partnerUserID as the `partnerName` config field.
3. Store the partnerUserSecret as a secret and reference it from config as `partnerPassword: secret("EXPENSIFY_PARTNER_PASSWORD")`.

## Configuration

| Field             | Type   | Required | Description                                                                                                                                          |
| ----------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `partnerName`     | string | Yes      | The Expensify API partnerUserID. Generate a credential pair in the Expensify web app under Settings → Account → API, and use the partnerUserID here. |
| `partnerPassword` | secret | Yes      | The Expensify API partnerUserSecret paired with the partnerUserID. Store it as a secret.                                                             |
| `lookbackDays`    | number | No       | How many calendar days of reports (by submit/created date) to fetch on a full sync. Defaults to 180.                                                 |
| `resources`       | array  | No       | Which Expensify resources to sync. Omit to sync all of them.                                                                                         |

## Resources

- **`expensify_report`** _(entity)_ - Expense reports with total, currency, workflow status (OPEN, SUBMITTED, APPROVED, REIMBURSED, ...), submitter, and submit/approve timestamps.
  - Endpoint: `POST /ExpensifyIntegrations (combinedReportData)`
  - `reportName`: Report title.
  - `total` _(cents)_: Report total in the smallest currency unit.
  - `currency`: ISO currency code of the report.
  - `status`: Workflow status (OPEN, SUBMITTED, APPROVED, REIMBURSED, CLOSED, ...), uppercased.
  - `submitterEmail`: Email of the report submitter.
  - `submittedDate`: Submission timestamp, if any.
  - `approvedDate`: Approval timestamp, if any.
  - `policyName`: Expense policy the report is under.
  - `expenseCount`: Number of expenses on the report.
- **`expensify_expense`** _(event)_ - Individual expenses (one event per transaction) timestamped at the expense creation date, carrying merchant, amount, currency, category, and parent report.
  - Endpoint: `POST /ExpensifyIntegrations (combinedReportData)`
  - Derived from the transactionList of every report in the lookback window and rewritten on every sync, so resyncs are idempotent.
  - `expenseId`: Expensify transaction id.
  - `reportId`: Parent report id.
  - `merchant`: Merchant name.
  - `amount` _(cents)_: Expense amount in the smallest currency unit.
  - `currency`: ISO currency code of the expense.
  - `category`: Expense category, if categorized.
  - `created`: Expense creation date (YYYY-MM-DD).
  - `comment`: Free-text comment on the expense.
  - `reimbursable`: Whether the expense is reimbursable.
- **`expensify_category_spend`** _(metric)_ - Daily expense spend bucketed by category and currency: the summed expense amount per (creation day, category, currency).
  - Endpoint: `POST /ExpensifyIntegrations (combinedReportData)`
  - Unit: cents
  - Granularity: day
  - Dimensions: `date`, `category`, `currency`
  - Measures: `expenseCount`
  - Aggregated in the connector from the same combinedReportData export used for reports and expenses. The metric value is the summed amount (smallest currency unit) for the bucket.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const expensify = {
  name: 'expensify',
  connectorId: 'expensify',
  config: {
    partnerName: 'your_partnerUserID',
    partnerPassword: secret('EXPENSIFY_PARTNER_PASSWORD'),
    lookbackDays: 180,
  },
};

export default defineConfig({
  connectors: [expensify],
  dashboards: {
    finance: defineDashboard({
      widgets: {
        spend_mtd: {
          kind: 'stat',
          title: 'Spend (30d)',
          window: '30d',
          metric: defineMetric({
            connector: expensify,
            shape: 'metric',
            name: 'expensify_category_spend',
            field: 'value',
            fn: 'sum',
          }),
        },
        daily_spend: {
          kind: 'timeseries',
          title: 'Daily spend',
          window: '90d',
          metric: defineMetric({
            connector: expensify,
            shape: 'metric',
            name: 'expensify_category_spend',
            field: 'value',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Expensify does not publish a fixed per-credential request rate limit. The connector issues at most two requests per sync (a report-export generate call followed by a download call) and relies on the shared HTTP client to honor 429 responses with backoff.

## Limitations

- Reports and expenses are fetched over a rolling lookback window (lookbackDays) and rewritten on every sync, so reports and expenses older than the window age out of storage. Category-spend metric history outside the window is preserved across incremental syncs.
- Amounts are reported in the smallest unit of each expense currency (e.g. cents for USD), matching the Expensify Integration Server output.
- The connector reads report data via the combinedReportData export (reports plus their transaction lists). Line-item receipt images and audit-log detail are out of scope.
- Category-spend is bucketed per (created day, category, currency); expenses without a category are grouped under "Uncategorized".

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Expensify API docs](https://integrations.expensify.com/Integration-Server/doc/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
