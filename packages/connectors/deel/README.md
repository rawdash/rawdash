<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-deel

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-deel)](https://www.npmjs.com/package/@rawdash/connector-deel)
[![license](https://img.shields.io/npm/l/@rawdash/connector-deel)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync people, contracts, and invoices from Deel for headcount, contractor-spend, and payroll dashboards.

> **Cost & frequency.** Deel is rate-limited to 5 requests / second per organization, shared across every token. People and contracts are re-fetched in full on each sync, so on large workforces a run spans many pages; syncing too often can exhaust the shared quota for other Deel integrations. Recommended sync interval: **6 hours**. Minimum sensible interval: **1 hour**.

## Install

```sh
npm install @rawdash/connector-deel
```

## Authentication

Authenticates with a Deel organization API token sent as a Bearer credential. An organization token is not tied to a user and keeps working when the creating user leaves, so it is the right choice for an unattended sync. The token carries the read scopes selected when it was generated.

1. Sign in to Deel as an admin and open Apps & Integrations -> Developer Center (older accounts: More -> Developer -> Access Tokens).
2. Generate a new Organization token, name it, and grant read scopes for People, Contracts, and Invoices.
3. Copy the token value once on creation - Deel shows it only once.
4. Store the token as a secret and reference it from config as `apiToken: secret("DEEL_API_TOKEN")`.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                                                            |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiToken`     | secret | Yes      | Deel organization API token with read scopes for people, contracts, and invoices. Generate one in the Deel Developer Center.                                                                           |
| `lookbackDays` | number | No       | How many days of invoices to sync, filtered by issued date. Defaults to 365. Invoices are synced over a rolling window and rewritten on every sync, so invoices issued before the window age out.      |
| `resources`    | array  | No       | Which Deel resources to sync. Omit to sync all of them. 'invoice_events' is derived from the invoices scan, so enabling it without 'invoices' still walks invoices but only writes the payment events. |

## Resources

- **`deel_person`** _(entity)_ - Workers on Deel with country, job title, employment type, start date, and current hiring status. Re-fetched in full on every sync.
  - Endpoint: `GET /rest/v2/people`
  - `fullName`: Worker full name.
  - `firstName`: Worker first name.
  - `lastName`: Worker last name.
  - `country`: Worker country (ISO country name/code).
  - `jobTitle`: Worker job title.
  - `employmentType`: Employment / engagement type (e.g. eor, contractor, global_payroll).
  - `status`: Hiring status of the worker (e.g. active / inactive).
  - `startDate`: When the worker started (Unix ms).
  - `terminationDate`: When the current employment ended (Unix ms; null while active).
- **`deel_contract`** _(entity)_ - Deel contracts with type (eor / contractor / global_payroll / ...), status, and compensation. Re-fetched in full on every sync.
  - Endpoint: `GET /rest/v2/contracts`
  - `type`: Contract type (e.g. eor, global_payroll, ongoing_time_based, milestones).
  - `status`: Contract lifecycle status.
  - `rate`: Compensation amount, parsed to a number.
  - `currency`: Compensation currency code.
  - `frequency`: Compensation frequency (e.g. monthly, hourly).
  - `startDate`: Contract start date (Unix ms).
  - `createdAt`: When the contract was created (Unix ms).
  - `terminationDate`: When the contract terminated (Unix ms; null if active).
- **`deel_invoice`** _(entity)_ - Contractor invoices with billed amount, total, currency, and status, linked to their contract. Synced over a rolling issued-date window and rewritten on every sync.
  - Endpoint: `GET /rest/v2/invoices`
  - `amount`: Billed amount, parsed to a number.
  - `total`: Total charged including fees and VAT, parsed to a number.
  - `currency`: Invoice currency code.
  - `status`: Invoice status (pending / paid / processing / ...).
  - `contractId`: Contract the invoice belongs to.
  - `issuedAt`: When the invoice was issued (Unix ms).
  - `paidAt`: When the invoice was paid (Unix ms; null if unpaid).
- **`deel_invoice_event`** _(event)_ - Invoice lifecycle events (issued / paid) derived from each invoice, carrying the invoice total for spend timeseries. The scope is cleared and rewritten on every sync.
  - Endpoint: `GET /rest/v2/invoices`
  - Derived from each invoice's issued_at / paid_at timestamps, not from a separate API call.
  - `invoiceId`: Invoice the event belongs to.
  - `contractId`: Contract id, denormalised.
  - `transition`: "issued" or "paid".
  - `amount`: Invoice total at the time of the event.
  - `currency`: Invoice currency code.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const deel = {
  name: 'deel',
  connectorId: 'deel',
  config: {
    apiToken: secret('DEEL_API_TOKEN'),
  },
};

export default defineConfig({
  connectors: [deel],
  dashboards: {
    workforce: defineDashboard({
      widgets: {
        headcount: {
          kind: 'stat',
          title: 'Headcount',
          metric: defineMetric({
            connector: deel,
            shape: 'entity',
            entityType: 'deel_person',
            fn: 'count',
          }),
        },
        active_contracts: {
          kind: 'stat',
          title: 'Active contracts',
          metric: defineMetric({
            connector: deel,
            shape: 'entity',
            entityType: 'deel_contract',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'in_progress' }],
          }),
        },
        invoiced_this_window: {
          kind: 'stat',
          title: 'Invoiced (total)',
          metric: defineMetric({
            connector: deel,
            shape: 'event',
            name: 'deel_invoice_event',
            field: 'amount',
            fn: 'sum',
            filter: [{ field: 'transition', op: 'eq', value: 'issued' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Deel enforces 5 requests per second per organization, shared across all tokens, and returns HTTP 429 without rate-limit headers when exceeded. The shared HTTP client retries 429 responses with exponential backoff; keep the sync interval modest so a backfill does not starve other integrations on the same organization.

## Limitations

- Deel does not expose an updated-since filter on the people or contracts list endpoints, so those resources are re-fetched in full on every sync and the stored scope is rewritten each run.
- Invoices are synced over a rolling window (lookbackDays back through today, filtered by issued date) and rewritten on every sync, so invoices issued before the window age out of storage.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Deel API docs](https://developer.deel.com)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
