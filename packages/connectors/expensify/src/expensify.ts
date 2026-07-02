import { connectorUserAgent } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type Entity,
  type Event,
  type JSONValue,
  type MetricSample,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  metricSample,
  schemasFromResources,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    partnerName: z.string().min(1).meta({
      label: 'Partner user ID',
      description:
        'The Expensify API partnerUserID. Generate a credential pair in the Expensify web app under Settings → Account → API, and use the partnerUserID here.',
      placeholder: 'your_partnerUserID',
    }),
    partnerPassword: z.object({ $secret: z.string() }).meta({
      label: 'Partner user secret',
      description:
        'The Expensify API partnerUserSecret paired with the partnerUserID. Store it as a secret.',
      placeholder: 'xxxxxxxxxxxxxxxx',
      secret: true,
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many calendar days of reports (by submit/created date) to fetch on a full sync. Defaults to 180.',
      placeholder: '180',
    }),
    resources: z
      .array(z.enum(['reports', 'expenses', 'expense_categories']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Expensify resources to sync. Omit to sync all of them.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Expensify',
  category: 'finance',
  brandColor: '#03D47C',
  tagline:
    'Sync Expensify expense reports, individual expenses, and daily category spend for finance-ops dashboards: reports pending, month-to-date spend, and spend by category.',
  vendor: {
    name: 'Expensify',
    domain: 'expensify.com',
    apiDocs: 'https://integrations.expensify.com/Integration-Server/doc/',
    website: 'https://www.expensify.com',
  },
  auth: {
    summary:
      'Expensify API partner credentials (partnerUserID + partnerUserSecret). Both are sent in the credentials block of every Integration Server request over HTTPS.',
    setup: [
      'In the Expensify web app, open Settings → Account → API and generate a partnerUserID / partnerUserSecret credential pair.',
      'Set the partnerUserID as the `partnerName` config field.',
      'Store the partnerUserSecret as a secret and reference it from config as `partnerPassword: secret("EXPENSIFY_PARTNER_PASSWORD")`.',
    ],
  },
  rateLimit:
    'Expensify does not publish a fixed per-credential request rate limit. The connector issues at most two requests per sync (a report-export generate call followed by a download call) and relies on the shared HTTP client to honor 429 responses with backoff.',
  limitations: [
    'Reports and expenses are fetched over a rolling lookback window (lookbackDays) and rewritten on every sync, so reports and expenses older than the window age out of storage. Category-spend metric history outside the window is preserved across incremental syncs.',
    'Amounts are reported in the smallest unit of each expense currency (e.g. cents for USD), matching the Expensify Integration Server output.',
    'The connector reads report data via the combinedReportData export (reports plus their transaction lists). Line-item receipt images and audit-log detail are out of scope.',
    'Category-spend is bucketed per (created day, category, currency); expenses without a category are grouped under "Uncategorized".',
  ],
});

export type ExpensifyResource = 'reports' | 'expenses' | 'expense_categories';

export interface ExpensifySettings {
  partnerName: string;
  lookbackDays?: number;
  resources?: readonly ExpensifyResource[];
}

const expensifyCredentials = {
  partnerPassword: {
    description: 'Expensify API partnerUserSecret',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type ExpensifyCredentials = typeof expensifyCredentials;

const ENDPOINT =
  'https://integrations.expensify.com/Integration-Server/ExpensifyIntegrations';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 180;
const INCREMENTAL_LOOKBACK_DAYS = 30;

const REPORT_ENTITY = 'expensify_report';
const EXPENSE_EVENT = 'expensify_expense';
const CATEGORY_METRIC = 'expensify_category_spend';

const ALL_RESOURCES: readonly ExpensifyResource[] = [
  'reports',
  'expenses',
  'expense_categories',
];

const dateString = z
  .string()
  .regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

const isoTimestampString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
  );

const expenseSchema = z.object({
  transactionID: z.string().min(1),
  merchant: z.string().nullish(),
  amount: z.number(),
  currency: z.string().nullish(),
  category: z.string().nullish(),
  created: dateString,
  comment: z.string().nullish(),
  reimbursable: z.boolean().nullish(),
});

const reportSchema = z.object({
  reportID: z.string().min(1),
  reportName: z.string().nullish(),
  total: z.number().nullish(),
  currency: z.string().nullish(),
  status: z.string().nullish(),
  submitterEmail: z.string().nullish(),
  submittedDate: isoTimestampString.nullish(),
  approvedDate: isoTimestampString.nullish(),
  policyName: z.string().nullish(),
  transactionList: z.array(expenseSchema).nullish(),
});

const combinedReportSchema = z.array(reportSchema);

export type ExpensifyReport = z.infer<typeof reportSchema>;
export type ExpensifyExpense = z.infer<typeof expenseSchema>;

export const expensifyResources = defineResources({
  [REPORT_ENTITY]: {
    shape: 'entity',
    description:
      'Expense reports with total, currency, workflow status (OPEN, SUBMITTED, APPROVED, REIMBURSED, ...), submitter, and submit/approve timestamps.',
    endpoint: 'POST /ExpensifyIntegrations (combinedReportData)',
    filterable: [],
    fields: [
      { name: 'reportName', description: 'Report title.' },
      {
        name: 'total',
        description: 'Report total in the smallest currency unit.',
        unit: 'cents',
      },
      { name: 'currency', description: 'ISO currency code of the report.' },
      {
        name: 'status',
        description:
          'Workflow status (OPEN, SUBMITTED, APPROVED, REIMBURSED, CLOSED, ...), uppercased.',
      },
      { name: 'submitterEmail', description: 'Email of the report submitter.' },
      { name: 'submittedDate', description: 'Submission timestamp, if any.' },
      { name: 'approvedDate', description: 'Approval timestamp, if any.' },
      {
        name: 'policyName',
        description: 'Expense policy the report is under.',
      },
      {
        name: 'expenseCount',
        description: 'Number of expenses on the report.',
      },
    ],
    responses: { reports: combinedReportSchema },
  },
  [EXPENSE_EVENT]: {
    shape: 'event',
    description:
      'Individual expenses (one event per transaction) timestamped at the expense creation date, carrying merchant, amount, currency, category, and parent report.',
    endpoint: 'POST /ExpensifyIntegrations (combinedReportData)',
    notes:
      'Derived from the transactionList of every report in the lookback window and rewritten on every sync, so resyncs are idempotent.',
    filterable: [],
    fields: [
      { name: 'expenseId', description: 'Expensify transaction id.' },
      { name: 'reportId', description: 'Parent report id.' },
      { name: 'merchant', description: 'Merchant name.' },
      {
        name: 'amount',
        description: 'Expense amount in the smallest currency unit.',
        unit: 'cents',
      },
      { name: 'currency', description: 'ISO currency code of the expense.' },
      { name: 'category', description: 'Expense category, if categorized.' },
      { name: 'created', description: 'Expense creation date (YYYY-MM-DD).' },
      { name: 'comment', description: 'Free-text comment on the expense.' },
      {
        name: 'reimbursable',
        description: 'Whether the expense is reimbursable.',
      },
    ],
    responses: { expenses: combinedReportSchema },
  },
  [CATEGORY_METRIC]: {
    shape: 'metric',
    description:
      'Daily expense spend bucketed by category and currency: the summed expense amount per (creation day, category, currency).',
    endpoint: 'POST /ExpensifyIntegrations (combinedReportData)',
    unit: 'cents',
    granularity: 'day',
    notes:
      'Aggregated in the connector from the same combinedReportData export used for reports and expenses. The metric value is the summed amount (smallest currency unit) for the bucket.',
    dimensions: [
      {
        name: 'date',
        description: 'Expense creation day (YYYY-MM-DD).',
      },
      {
        name: 'category',
        description: 'Expense category, or "Uncategorized" when absent.',
      },
      {
        name: 'currency',
        description: 'ISO currency code the amount is denominated in.',
      },
    ],
    measures: [
      {
        name: 'expenseCount',
        description: 'Number of expenses aggregated into the bucket.',
      },
    ],
    responses: { expense_categories: combinedReportSchema },
  },
});

interface DateWindow {
  from: string;
  to: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

function isoDateToMs(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return NaN;
  }
  return Date.UTC(y, m - 1, d);
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const direct = Date.parse(value.replace(' ', 'T'));
  if (Number.isFinite(direct)) {
    return direct;
  }
  const dayMs = isoDateToMs(value);
  return Number.isFinite(dayMs) ? dayMs : null;
}

export function getReportWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): DateWindow {
  const today = startOfUtcDay(now);
  if (options.mode === 'latest') {
    return {
      from: toIsoDate(today - (INCREMENTAL_LOOKBACK_DAYS - 1) * MS_PER_DAY),
      to: toIsoDate(today),
    };
  }
  if (options.since) {
    const sinceMs = new Date(options.since).getTime();
    if (Number.isFinite(sinceMs)) {
      const requested = Math.max(
        1,
        Math.ceil((today - startOfUtcDay(sinceMs)) / MS_PER_DAY) + 1,
      );
      const capped = Math.min(requested, lookbackDays);
      return {
        from: toIsoDate(today - (capped - 1) * MS_PER_DAY),
        to: toIsoDate(today),
      };
    }
  }
  return {
    from: toIsoDate(today - (lookbackDays - 1) * MS_PER_DAY),
    to: toIsoDate(today),
  };
}

export function reportToEntity(report: ExpensifyReport): Entity {
  const updatedAt =
    parseTimestamp(report.approvedDate) ??
    parseTimestamp(report.submittedDate) ??
    0;
  const attributes: Record<string, JSONValue> = {
    reportName: report.reportName ?? null,
    total: report.total ?? null,
    currency: report.currency ?? null,
    status: report.status ? report.status.toUpperCase() : null,
    submitterEmail: report.submitterEmail ?? null,
    submittedDate: report.submittedDate ?? null,
    approvedDate: report.approvedDate ?? null,
    policyName: report.policyName ?? null,
    expenseCount: report.transactionList?.length ?? 0,
  };
  return {
    type: REPORT_ENTITY,
    id: report.reportID,
    attributes,
    updated_at: updatedAt,
  };
}

export function reportToExpenseEvents(report: ExpensifyReport): Event[] {
  return (report.transactionList ?? []).map((expense) => {
    const ts = isoDateToMs(expense.created);
    const attributes: Record<string, JSONValue> = {
      expenseId: expense.transactionID,
      reportId: report.reportID,
      merchant: expense.merchant ?? null,
      amount: expense.amount,
      currency: expense.currency ?? report.currency ?? null,
      category: expense.category ?? null,
      created: expense.created,
      comment: expense.comment ?? null,
      reimbursable: expense.reimbursable ?? null,
    };
    return {
      name: EXPENSE_EVENT,
      start_ts: Number.isFinite(ts) ? ts : 0,
      end_ts: null,
      attributes,
    };
  });
}

interface CategoryBucket {
  date: string;
  category: string;
  currency: string;
  total: number;
  count: number;
}

export function categoryBuckets(reports: ExpensifyReport[]): CategoryBucket[] {
  const byKey = new Map<string, CategoryBucket>();
  for (const report of reports) {
    for (const expense of report.transactionList ?? []) {
      const date = expense.created;
      const category = expense.category ?? 'Uncategorized';
      const currency = expense.currency ?? report.currency ?? 'USD';
      const key = `${date} ${category} ${currency}`;
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = { date, category, currency, total: 0, count: 0 };
        byKey.set(key, bucket);
      }
      bucket.total += expense.amount;
      bucket.count += 1;
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

export function categoryBucketToMetricSample(
  bucket: CategoryBucket,
): MetricSample {
  const ts = isoDateToMs(bucket.date);
  return metricSample(expensifyResources, CATEGORY_METRIC, {
    ts: Number.isFinite(ts) ? ts : 0,
    value: bucket.total,
    attributes: {
      date: bucket.date,
      category: bucket.category,
      currency: bucket.currency,
      expenseCount: bucket.count,
    },
  });
}

function parseReportArray(body: unknown): ExpensifyReport[] | null {
  let candidate: unknown = body;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed.startsWith('[')) {
      return null;
    }
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(candidate)) {
    return null;
  }
  return combinedReportSchema.parse(candidate);
}

function expensifyErrorMessage(body: unknown): string | null {
  if (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'responseCode' in body
  ) {
    const record = body as {
      responseCode?: unknown;
      responseMessage?: unknown;
    };
    const code =
      typeof record.responseCode === 'number' ? record.responseCode : null;
    if (code !== null && code >= 200 && code < 300) {
      return null;
    }
    const message =
      typeof record.responseMessage === 'string'
        ? record.responseMessage
        : 'unknown error';
    return `Expensify Integration Server error ${code ?? 'unknown'}: ${message}`;
  }
  return null;
}

function extractFileName(body: unknown): string | null {
  if (typeof body !== 'string') {
    return null;
  }
  const trimmed = body.trim();
  return trimmed.length > 0 &&
    !trimmed.startsWith('[') &&
    !trimmed.startsWith('{')
    ? trimmed
    : null;
}

const COMBINED_REPORT_TEMPLATE =
  '[<#list reports as report><#if report_index != 0>,</#if>' +
  '{"reportID":"${report.reportID}","reportName":"${(report.reportName)!\'\'}",' +
  '"total":${(report.total)!0},"currency":"${(report.currency)!\'\'}",' +
  '"status":"${(report.status)!\'\'}","submitterEmail":"${(report.submitterEmail)!\'\'}",' +
  '"submittedDate":"${(report.submitted)!\'\'}","approvedDate":"${(report.approved)!\'\'}",' +
  '"policyName":"${(report.policyName)!\'\'}","transactionList":[' +
  '<#list report.transactionList as expense><#if expense_index != 0>,</#if>' +
  '{"transactionID":"${expense.transactionID}","merchant":"${(expense.merchant)!\'\'}",' +
  '"amount":${(expense.amount)!0},"currency":"${(expense.currency)!\'\'}",' +
  '"category":"${(expense.category)!\'\'}","created":"${expense.created}",' +
  '"comment":"${(expense.comment)!\'\'}","reimbursable":${(expense.reimbursable)?c}}' +
  '</#list>]}</#list>]';

export const id = 'expensify';

export class ExpensifyConnector extends BaseConnector<
  ExpensifySettings,
  ExpensifyCredentials
> {
  static readonly id = id;

  static readonly resources = expensifyResources;

  static readonly schemas = schemasFromResources(expensifyResources);

  static create(input: unknown, ctx?: ConnectorContext): ExpensifyConnector {
    const parsed = configFields.parse(input);
    return new ExpensifyConnector(
      {
        partnerName: parsed.partnerName,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { partnerPassword: parsed.partnerPassword },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = expensifyCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': connectorUserAgent('expensify'),
    };
  }

  private credentialsBlock(): {
    partnerUserID: string;
    partnerUserSecret: string;
  } {
    return {
      partnerUserID: this.settings.partnerName,
      partnerUserSecret: this.creds.partnerPassword,
    };
  }

  private async postJob(
    requestJobDescription: Record<string, unknown>,
    resource: string,
    template: string | undefined,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const form = new URLSearchParams({
      requestJobDescription: JSON.stringify(requestJobDescription),
    });
    if (template !== undefined) {
      form.set('template', template);
    }
    const res = await this.post<unknown>(ENDPOINT, {
      resource,
      headers: this.buildHeaders(),
      body: form.toString(),
      signal,
    });
    return res.body;
  }

  private async fetchCombinedReportData(
    window: DateWindow,
    signal?: AbortSignal,
  ): Promise<ExpensifyReport[]> {
    const generated = await this.postJob(
      {
        type: 'file',
        credentials: this.credentialsBlock(),
        onReceive: { immediateResponse: ['returnRandomFileName'] },
        inputSettings: {
          type: 'combinedReportData',
          filters: { startDate: window.from, endDate: window.to },
        },
        outputSettings: { fileExtension: 'json' },
      },
      'reports_generate',
      COMBINED_REPORT_TEMPLATE,
      signal,
    );
    const generatedError = expensifyErrorMessage(generated);
    if (generatedError) {
      throw new Error(generatedError);
    }
    const inline = parseReportArray(generated);
    if (inline) {
      return inline;
    }
    const fileName = extractFileName(generated);
    if (!fileName) {
      throw new Error(
        'Expensify: report-export generate call returned neither report data nor a file name.',
      );
    }
    const downloaded = await this.postJob(
      {
        type: 'download',
        credentials: this.credentialsBlock(),
        fileName,
        fileSystem: 'integrationServer',
      },
      'reports_download',
      undefined,
      signal,
    );
    const downloadedError = expensifyErrorMessage(downloaded);
    if (downloadedError) {
      throw new Error(downloadedError);
    }
    const data = parseReportArray(downloaded);
    if (!data) {
      throw new Error(
        `Expensify: download of report file "${fileName}" did not return report data.`,
      );
    }
    return data;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const window = getReportWindow(options, lookbackDays);
    const active = new Set<ExpensifyResource>(
      this.settings.resources ?? ALL_RESOURCES,
    );

    const reports = await this.fetchCombinedReportData(window, signal);

    if (active.has('reports')) {
      const entities = reports.map(reportToEntity);
      await storage.entities(entities, { types: [REPORT_ENTITY] });
    }

    if (active.has('expenses')) {
      const events = reports.flatMap(reportToExpenseEvents);
      await storage.events(events, { names: [EXPENSE_EVENT] });
    }

    if (active.has('expense_categories')) {
      const buckets = categoryBuckets(reports);
      const samples = buckets.map(categoryBucketToMetricSample);
      const fromMs = isoDateToMs(window.from);
      const toMs = isoDateToMs(window.to);
      const times = samples.map((s) => s.ts);
      const replaceWindow =
        Number.isFinite(fromMs) && Number.isFinite(toMs)
          ? {
              start: Math.min(fromMs, ...times),
              end: Math.max(toMs + MS_PER_DAY - 1, ...times),
            }
          : undefined;
      await storage.metrics(samples, {
        names: [CATEGORY_METRIC],
        ...(replaceWindow ? { replaceWindow } : {}),
      });
    }

    return { done: true };
  }
}
