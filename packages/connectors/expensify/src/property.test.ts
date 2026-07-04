import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorMetricConformanceViolations,
  connectorResourceShapeViolations,
  entityStoreFor,
  eventStoreFor,
  installFetchMock,
  metricStoreFor,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { ExpensifyConnector } from './expensify';

const CONNECTOR_ID = 'expensify';
const SECRET = 'EXPENSIFY_PARTNER_PASSWORD' as unknown as { $secret: string };

type CombinedReport = z.infer<typeof ExpensifyConnector.schemas.reports>;

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] => [
  ...connectorResourceShapeViolations(
    ExpensifyConnector.resources,
    storage,
    connectorId,
  ),
  ...connectorMetricConformanceViolations(
    ExpensifyConnector.resources,
    storage,
    connectorId,
  ),
];

function makeConnector(resources?: string[]) {
  return new ExpensifyConnector(
    { partnerName: 'pid', resources: resources as never, lookbackDays: 90 },
    { partnerPassword: SECRET },
  );
}

function distinctReportCount(sample: CombinedReport): number {
  return new Set(sample.map((r) => r.reportID)).size;
}

function totalExpenseCount(sample: CombinedReport): number {
  return sample.reduce((sum, r) => sum + (r.transactionList?.length ?? 0), 0);
}

function distinctCategoryBuckets(sample: CombinedReport): number {
  const keys = new Set<string>();
  for (const report of sample) {
    for (const expense of report.transactionList ?? []) {
      const category = expense.category ?? 'Uncategorized';
      const currency = expense.currency ?? report.currency ?? 'USD';
      keys.add(`${expense.created} ${category} ${currency}`);
    }
  }
  return keys.size;
}

function reportEntityCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: CombinedReport,
): InvariantViolation[] {
  const byType = entityStoreFor(storage, connectorId).get('expensify_report');
  const got = byType?.size ?? 0;
  const expected = distinctReportCount(sample);
  if (got !== expected) {
    return [
      {
        invariant: 'one expensify_report entity per distinct reportID',
        location: 'reports phase',
        detail: `expected ${expected} entities, got ${got}`,
      },
    ];
  }
  return [];
}

function expenseEventCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: CombinedReport,
): InvariantViolation[] {
  const events = eventStoreFor<{ name: string }>(storage, connectorId).filter(
    (e) => e.name === 'expensify_expense',
  );
  const expected = totalExpenseCount(sample);
  if (events.length !== expected) {
    return [
      {
        invariant: 'one expensify_expense event per transaction',
        location: 'expenses phase',
        detail: `expected ${expected} events, got ${events.length}`,
      },
    ];
  }
  return [];
}

function categoryMetricCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: CombinedReport,
): InvariantViolation[] {
  const metrics = metricStoreFor(storage, connectorId).filter(
    (m) => m.name === 'expensify_category_spend',
  );
  const expected = distinctCategoryBuckets(sample);
  if (metrics.length !== expected) {
    return [
      {
        invariant:
          'one expensify_category_spend sample per distinct (date, category, currency)',
        location: 'expense_categories phase',
        detail: `expected ${expected} metrics, got ${metrics.length}`,
      },
    ];
  }
  return [];
}

describe('ExpensifyConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<CombinedReport>({
      connectorClass: ExpensifyConnector,
      resource: 'reports',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [reportEntityCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        await makeConnector(['reports']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('expenses: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<CombinedReport>({
      connectorClass: ExpensifyConnector,
      resource: 'expenses',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [expenseEventCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        await makeConnector(['expenses']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('expense_categories: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<CombinedReport>({
      connectorClass: ExpensifyConnector,
      resource: 'expense_categories',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [categoryMetricCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        await makeConnector(['expense_categories']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented resource shapes', async () => {
    installFetchMock(() => [
      {
        reportID: 'R1',
        reportName: 'March travel',
        total: 45000,
        currency: 'USD',
        status: 'APPROVED',
        submitterEmail: 'jane@acme.com',
        submittedDate: '2025-03-02 09:00:00',
        approvedDate: '2025-03-03 10:00:00',
        policyName: 'Default',
        transactionList: [
          {
            transactionID: 'T1',
            merchant: 'Delta',
            amount: 30000,
            currency: 'USD',
            category: 'Airfare',
            created: '2025-03-01',
            reimbursable: true,
          },
        ],
      },
    ]);

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      ExpensifyConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
