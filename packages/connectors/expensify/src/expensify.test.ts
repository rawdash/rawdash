import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ExpensifyConnector,
  type ExpensifyReport,
  categoryBuckets,
  configFields,
  getReportWindow,
} from './expensify';

const CONNECTOR_ID = 'expensify';
const SECRET = 'EXPENSIFY_PARTNER_PASSWORD' as unknown as { $secret: string };

interface MockCall {
  url: string;
  job: { type?: string; [key: string]: unknown };
  body: string;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function textResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/plain' }),
    text: () => Promise.resolve(body),
  } as Response;
}

const REPORTS: ExpensifyReport[] = [
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
        comment: 'Flight to NYC',
        reimbursable: true,
      },
      {
        transactionID: 'T2',
        merchant: 'Hilton',
        amount: 15000,
        currency: 'USD',
        category: 'Lodging',
        created: '2025-03-01',
        reimbursable: true,
      },
    ],
  },
  {
    reportID: 'R2',
    reportName: 'Team lunch',
    total: 8000,
    currency: 'USD',
    status: 'SUBMITTED',
    submitterEmail: 'sam@acme.com',
    submittedDate: '2025-03-05 12:00:00',
    transactionList: [
      {
        transactionID: 'T3',
        merchant: 'Sweetgreen',
        amount: 8000,
        currency: 'USD',
        category: 'Meals',
        created: '2025-03-04',
      },
    ],
  },
];

function makeTwoPhaseFetch(reports: ExpensifyReport[] = REPORTS): {
  spy: ReturnType<typeof vi.fn>;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  const spy = vi
    .fn()
    .mockImplementation((url: string | URL, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      const body = String(init?.body ?? '');
      const params = new URLSearchParams(body);
      const job = JSON.parse(params.get('requestJobDescription') ?? '{}');
      calls.push({ url: u, job, body });
      if (job.type === 'file') {
        return Promise.resolve(textResponse('exportABC123.json'));
      }
      return Promise.resolve(jsonResponse(reports));
    });
  return { spy, calls };
}

describe('configFields', () => {
  it('parses a minimal config with partner credentials', () => {
    expect(
      configFields.safeParse({
        partnerName: 'pid',
        partnerPassword: { $secret: 'EXPENSIFY_PARTNER_PASSWORD' },
      }).success,
    ).toBe(true);
  });

  it('parses a config with lookbackDays and resources', () => {
    expect(
      configFields.safeParse({
        partnerName: 'pid',
        partnerPassword: { $secret: 'EXPENSIFY_PARTNER_PASSWORD' },
        lookbackDays: 90,
        resources: ['reports', 'expenses'],
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        partnerName: 'pid',
        partnerPassword: { $secret: 'EXPENSIFY_PARTNER_PASSWORD' },
        resources: ['reports', 'receipts'],
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string partnerPassword instead of a secret object', () => {
    expect(
      configFields.safeParse({ partnerName: 'pid', partnerPassword: 'abc' })
        .success,
    ).toBe(false);
  });

  it('rejects a config missing the partner name', () => {
    expect(
      configFields.safeParse({
        partnerPassword: { $secret: 'EXPENSIFY_PARTNER_PASSWORD' },
      }).success,
    ).toBe(false);
  });
});

describe('getReportWindow', () => {
  const now = Date.UTC(2025, 2, 10, 12);

  it('uses the full lookback window for a full sync', () => {
    const window = getReportWindow({ mode: 'full' }, 30, now);
    expect(window.to).toBe('2025-03-10');
    expect(window.from).toBe('2025-02-09');
  });

  it('uses a short window for an incremental sync', () => {
    const window = getReportWindow({ mode: 'latest' }, 180, now);
    expect(window.to).toBe('2025-03-10');
    expect(window.from).toBe('2025-02-09');
  });

  it('caps the window at lookbackDays even with an older since', () => {
    const window = getReportWindow(
      { mode: 'full', since: '2024-01-01' },
      30,
      now,
    );
    expect(window.from).toBe('2025-02-09');
  });
});

describe('categoryBuckets', () => {
  it('sums amounts per (date, category, currency)', () => {
    const buckets = categoryBuckets(REPORTS);
    const airfare = buckets.find((b) => b.category === 'Airfare');
    const lodging = buckets.find((b) => b.category === 'Lodging');
    expect(airfare).toMatchObject({
      date: '2025-03-01',
      currency: 'USD',
      total: 30000,
      count: 1,
    });
    expect(lodging?.total).toBe(15000);
  });

  it('groups uncategorized expenses under "Uncategorized"', () => {
    const buckets = categoryBuckets([
      {
        reportID: 'R9',
        currency: 'USD',
        transactionList: [
          { transactionID: 'X', amount: 500, created: '2025-01-01' },
        ],
      },
    ]);
    expect(buckets[0]).toMatchObject({
      category: 'Uncategorized',
      currency: 'USD',
      total: 500,
    });
  });
});

describe('ExpensifyConnector sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows the two-phase generate + download flow and sends partner credentials', async () => {
    const { spy, calls } = makeTwoPhaseFetch();
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    await new ExpensifyConnector(
      { partnerName: 'pid-123' },
      { partnerPassword: SECRET },
    ).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    expect(calls.map((c) => c.job.type)).toEqual(['file', 'download']);
    const generate = calls[0]!;
    expect(
      (generate.job.credentials as { partnerUserID?: string }).partnerUserID,
    ).toBe('pid-123');
    expect(
      (generate.job.credentials as { partnerUserSecret?: string })
        .partnerUserSecret,
    ).toBe('EXPENSIFY_PARTNER_PASSWORD');
    expect(new URLSearchParams(generate.body).get('template')).toContain(
      'transactionList',
    );
    expect(calls[1]!.job.fileName).toBe('exportABC123.json');
  });

  it('writes report entities, expense events, and category metrics', async () => {
    const { spy } = makeTwoPhaseFetch();
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    await new ExpensifyConnector(
      { partnerName: 'pid' },
      { partnerPassword: SECRET },
    ).sync({ mode: 'full' }, handle);

    const reports = await handle.queryEntities({ type: 'expensify_report' });
    expect(reports).toHaveLength(2);
    const r1 = reports.find((e) => e.id === 'R1')!;
    expect(r1.attributes).toMatchObject({
      status: 'APPROVED',
      total: 45000,
      submitterEmail: 'jane@acme.com',
      expenseCount: 2,
    });

    const expenses = await handle.queryEvents({ name: 'expensify_expense' });
    expect(expenses).toHaveLength(3);
    expect(expenses.map((e) => e.attributes.expenseId).sort()).toEqual([
      'T1',
      'T2',
      'T3',
    ]);

    const metrics = await handle.queryMetrics({
      name: 'expensify_category_spend',
    });
    expect(metrics).toHaveLength(3);
    const airfare = metrics.find((m) => m.attributes.category === 'Airfare')!;
    expect(airfare.value).toBe(30000);
    expect(airfare.attributes).toMatchObject({
      date: '2025-03-01',
      currency: 'USD',
      expenseCount: 1,
    });
  });

  it('short-circuits the download when the generate call returns data inline', async () => {
    const calls: MockCall[] = [];
    const spy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const body = String(init?.body ?? '');
        const params = new URLSearchParams(body);
        const job = JSON.parse(params.get('requestJobDescription') ?? '{}');
        calls.push({ url: u, job, body });
        return Promise.resolve(jsonResponse(REPORTS));
      });
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    await new ExpensifyConnector(
      { partnerName: 'pid' },
      { partnerPassword: SECRET },
    ).sync({ mode: 'full' }, handle);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.job.type).toBe('file');
    expect(
      await handle.queryEntities({ type: 'expensify_report' }),
    ).toHaveLength(2);
  });

  it('only syncs the requested resource', async () => {
    const { spy } = makeTwoPhaseFetch();
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    await new ExpensifyConnector(
      { partnerName: 'pid', resources: ['reports'] },
      { partnerPassword: SECRET },
    ).sync({ mode: 'full' }, handle);

    expect(
      await handle.queryEntities({ type: 'expensify_report' }),
    ).toHaveLength(2);
    expect(
      await handle.queryEvents({ name: 'expensify_expense' }),
    ).toHaveLength(0);
    expect(
      await handle.queryMetrics({ name: 'expensify_category_spend' }),
    ).toHaveLength(0);
  });

  it('throws on an Expensify Integration Server error response', async () => {
    const spy = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          responseCode: 500,
          responseMessage: 'Bad credentials',
        }),
      ),
    );
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    await expect(
      new ExpensifyConnector(
        { partnerName: 'pid' },
        { partnerPassword: SECRET },
      ).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID)),
    ).rejects.toThrow(/Bad credentials/);
  });

  it('preserves category-spend history outside the synced window on incremental sync', async () => {
    const { spy } = makeTwoPhaseFetch();
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    const oldTs = Date.UTC(2020, 0, 1);
    await handle.metric({
      name: 'expensify_category_spend',
      ts: oldTs,
      value: 999,
      attributes: { date: '2020-01-01', category: 'Meals', currency: 'USD' },
    });

    await new ExpensifyConnector(
      { partnerName: 'pid', resources: ['expense_categories'] },
      { partnerPassword: SECRET },
    ).sync({ mode: 'latest' }, handle);

    const preserved = (
      await handle.queryMetrics({ name: 'expensify_category_spend' })
    ).filter((m) => m.ts === oldTs);
    expect(preserved).toHaveLength(1);
  });
});
