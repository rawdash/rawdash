<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-bill

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-bill)](https://www.npmjs.com/package/@rawdash/connector-bill)
[![license](https://img.shields.io/npm/l/@rawdash/connector-bill)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync accounts-payable bills, vendors, and vendor payments from BILL (Bill.com) for AP aging, bills-pending, and vendor-spend dashboards.

## Install

```sh
npm install @rawdash/connector-bill
```

## Authentication

Session-based sign in against the BILL v3 API. The connector signs in with a developer key, username, password, and organization ID to obtain a session, then reuses it for the rest of the sync.

1. Request a BILL developer key from the BILL Developer portal and note the key value.
2. Create or choose a BILL user with access to the organization you want to sync.
3. Find the organization ID for that organization (visible in the app URL or via the List Organizations API).
4. Store the developer key and the user password as rawdash secrets and reference them from the connector config as `devKey: secret("BILL_DEV_KEY")` and `password: secret("BILL_PASSWORD")`.

## Configuration

| Field       | Type   | Required | Description                                                                                                         |
| ----------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `devKey`    | secret | Yes      | BILL developer key that authorizes API access for your app. Find it in the BILL Developer portal under your app.    |
| `username`  | string | Yes      | Email address of the BILL user the API signs in as. This user must have access to the organization you are syncing. |
| `password`  | secret | Yes      | Password for the BILL user. Stored as a secret.                                                                     |
| `orgId`     | string | Yes      | BILL organization ID to sync. Find it in the BILL app URL or via the List Organizations API.                        |
| `resources` | array  | No       | Which BILL resources to sync. Omit to sync all of them (bills, vendors, payments).                                  |

## Resources

- **`bill_vendor`** _(entity)_ - Vendors (suppliers) with name, contact details, account number, and archived state.
  - Endpoint: `GET /v3/vendors`
  - Incremental syncs filter on updatedTime and sort ascending so resumable pages stay ordered.
  - `name`: Vendor display name.
  - `email`: Vendor contact email, if set.
  - `accountNumber`: Your account number with the vendor, if set.
  - `phone`: Vendor phone number, if set.
  - `archived`: Whether the vendor has been archived.
  - `billCurrency`: Default bill currency for the vendor (ISO code).
  - `createdAt`: When the vendor was created (Unix ms).
- **`bill_bill`** _(entity)_ - Accounts-payable bills with vendor, invoice number, invoice and due dates, amount, and payment status.
  - Endpoint: `GET /v3/bills`
  - Amounts are in the bill currency major units (e.g. dollars). Incremental syncs filter on updatedTime so status transitions are re-fetched.
  - `vendorId`: Vendor the bill is owed to.
  - `invoiceNumber`: Vendor invoice number, if set.
  - `invoiceDate`: Invoice date (Unix ms), if set.
  - `dueDate`: Payment due date (Unix ms), if set.
  - `amount`: Bill total in the bill currency major units.
  - `paymentStatus`: Payment status (UNPAID, PARTIALLY_PAID, PAID, ...).
  - `approvalStatus`: Approval status (UNASSIGNED, APPROVED, ...), if set.
  - `archived`: Whether the bill has been archived.
  - `createdAt`: When the bill was created (Unix ms).
- **`bill_payment`** _(event)_ - Vendor payments (money sent to vendors), one event per payment timestamped at its process date.
  - Endpoint: `GET /v3/payments`
  - `id`: BILL payment id.
  - `vendorId`: Vendor paid, if set.
  - `billId`: Bill the payment applies to, if set.
  - `amount`: Payment amount in the payment currency major units.
  - `status`: Payment status (SCHEDULED, PAID, CANCELED).
  - `description`: Payment description, if set.
  - `processDate`: Scheduled or actual process date (Unix ms), if set.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const bill = {
  name: 'bill',
  connectorId: 'bill',
  config: {
    devKey: secret('BILL_DEV_KEY'),
    username: 'api-user@example.com',
    password: secret('BILL_PASSWORD'),
    orgId: '00801ABCDEFGHIJKLMNO',
    resources: ['bills', 'vendors', 'payments'],
  },
};

export default defineConfig({
  connectors: [bill],
  dashboards: {
    payables: defineDashboard({
      widgets: {
        bills_pending: {
          kind: 'stat',
          title: 'Bills pending',
          metric: defineMetric({
            connector: bill,
            shape: 'entity',
            entityType: 'bill_bill',
            fn: 'count',
            filter: [{ field: 'paymentStatus', op: 'eq', value: 'UNPAID' }],
          }),
        },
        ap_balance: {
          kind: 'stat',
          title: 'AP balance (unpaid)',
          metric: defineMetric({
            connector: bill,
            shape: 'entity',
            entityType: 'bill_bill',
            field: 'amount',
            fn: 'sum',
            filter: [{ field: 'paymentStatus', op: 'eq', value: 'UNPAID' }],
          }),
        },
        payments_30d: {
          kind: 'timeseries',
          title: 'Vendor payments (30d)',
          window: '30d',
          metric: defineMetric({
            connector: bill,
            shape: 'event',
            name: 'bill_payment',
            field: 'amount',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

BILL does not publish standard rate-limit response headers; the shared HTTP client retries 429 responses with exponential backoff. Sessions expire after 35 minutes of inactivity and are transparently re-established on a 401.

## Limitations

- Monetary amounts are stored in major currency units (e.g. dollars), matching the BILL API, not in the smallest unit.
- Incremental syncs filter on updatedTime, so status transitions (a bill moving from UNPAID to PAID) are picked up on the next run.
- The set of synced resources is controlled by the `resources` config field; omit it to sync all of them.
- Bill line items and approval workflow detail are out of scope; only the header-level bill, its vendor, and vendor payments are synced.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Bill.com API docs](https://developer.bill.com/docs/home)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
