import {
  type HttpResponse,
  connectorUserAgent,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorCost,
  type ConnectorDoc,
  type CredentialsSchema,
  type FetchPageResult,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  makeChunkedCursorGuard,
  paginateChunked,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    clientId: z.string().min(1).meta({
      label: 'Client ID',
      description:
        'OAuth 2.0 client ID issued to your ADP Workforce Now API application (ADP Marketplace / API Central).',
      placeholder: 'abcd1234-...',
    }),
    clientSecret: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Client secret',
      description:
        'OAuth 2.0 client secret paired with the client ID. Stored as a secret.',
      placeholder: 'ADP_CLIENT_SECRET',
      secret: true,
    }),
    certPem: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Client certificate (PEM)',
      description:
        'PEM-encoded client certificate for the mutual-TLS channel ADP requires on api.adp.com. Provided to the runtime that terminates TLS; see the README for how mTLS is handled.',
      placeholder: 'ADP_CERT_PEM',
      secret: true,
    }),
    keyPem: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Client private key (PEM)',
      description:
        'PEM-encoded private key matching the client certificate. Stored as a secret and used by the runtime for the mTLS handshake.',
      placeholder: 'ADP_KEY_PEM',
      secret: true,
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Payroll lookback days',
      description:
        'How many days of payroll output to sync, filtered by pay date. Defaults to 365. Payroll is synced over a rolling window and rewritten on every sync, so pay cycles older than the window age out of storage.',
      placeholder: '365',
    }),
    resources: z
      .array(z.enum(['workers', 'payrolls']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which ADP resources to sync. Omit to sync all of them. The payrolls resource writes both the per-cycle payroll entity and the derived payroll spend metric.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'ADP',
  category: 'hr',
  brandColor: '#D0271D',
  tagline:
    'Sync workers and per-cycle payroll output from ADP Workforce Now for headcount, payroll-spend, and pay-cycle trend dashboards.',
  vendor: {
    name: 'ADP',
    domain: 'adp.com',
    apiDocs: 'https://developers.adp.com/articles/api/wfn-api-explorer',
    website: 'https://www.adp.com',
  },
  auth: {
    summary:
      'OAuth 2.0 client-credentials against the ADP token endpoint, over a mutual-TLS channel. ADP issues a client ID / secret plus a client certificate when you register a Workforce Now API application; the certificate authenticates the TLS connection to api.adp.com and the client credentials mint a short-lived bearer token for each call.',
    setup: [
      'Register (or reuse) a Workforce Now API application in the ADP Marketplace / API Central to obtain a client ID and client secret.',
      'Generate the mutual-TLS client certificate and private key ADP provisions for the application; download the certificate (PEM) and private key (PEM).',
      'Grant the application read scopes for Worker Demographics / Worker Management and Payroll Output.',
      'Store the client secret, certificate PEM, and private key PEM as secrets and reference them from config as `clientSecret: secret("ADP_CLIENT_SECRET")`, `certPem: secret("ADP_CERT_PEM")`, and `keyPem: secret("ADP_KEY_PEM")`.',
    ],
  },
  rateLimit:
    'ADP enforces per-application throttling on the Workforce Now APIs and returns HTTP 429 when exceeded; the shared HTTP client retries 429 responses with exponential backoff. Keep the sync interval modest so a backfill does not exhaust the application quota.',
  limitations: [
    'ADP requires mutual TLS on api.adp.com. The rawdash HTTP client is fetch-based and cannot present a client certificate itself, so the certificate and private key are surfaced as secrets for the runtime / egress proxy that terminates TLS. In an environment without mTLS termination the sync cannot reach ADP.',
    'The Worker endpoint has no reliable updated-since filter, so workers are re-fetched in full on every sync and the stored scope is rewritten each run.',
    'Payroll is read as employer per-pay-cycle output summaries (gross / net / taxes / deductions per pay group and pay date) over a rolling lookback window, not as per-worker pay statements. Individual pay-statement detail is out of scope for the v1 dashboard use case.',
  ],
});

export const cost: ConnectorCost = {
  recommendedInterval: '12 hours',
  minInterval: '1 hour',
  warning:
    'Workers are re-fetched in full on each sync and payroll output is walked over the lookback window, so a run can span many pages on large populations. ADP throttles per application, so syncing too often can exhaust the shared quota.',
};

export type AdpResource = 'workers' | 'payrolls';

export interface AdpSettings {
  lookbackDays?: number;
  resources?: readonly AdpResource[];
}

const adpCredentials = {
  clientId: {
    description: 'ADP OAuth 2.0 client ID',
    auth: 'required' as const,
  },
  clientSecret: {
    description: 'ADP OAuth 2.0 client secret',
    auth: 'required' as const,
  },
  certPem: {
    description: 'ADP mutual-TLS client certificate (PEM)',
    auth: 'required' as const,
  },
  keyPem: {
    description: 'ADP mutual-TLS client private key (PEM)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type AdpCredentials = typeof adpCredentials;

const PHASE_ORDER = ['workers', 'payrolls'] as const;

type AdpPhase = (typeof PHASE_ORDER)[number];

const isAdpSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

type AdpSyncCursor = ChunkedSyncCursor<AdpPhase, string>;

const PER_PAGE = 100;
const MAX_PAGES = 200;
const API_BASE = 'https://api.adp.com';
const TOKEN_URL = 'https://accounts.adp.com/auth/oauth/v2/token';
const DEFAULT_LOOKBACK_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const WORKER_ENTITY = 'adp_worker';
const PAYROLL_ENTITY = 'adp_payroll';
const PAYROLL_METRIC = 'adp_payroll_metric';

const codeSchema = z.object({
  codeValue: z.string().nullish(),
  shortName: z.string().nullish(),
  longName: z.string().nullish(),
});

const orgUnitSchema = z.object({
  typeCode: codeSchema.nullish(),
  nameCode: codeSchema.nullish(),
});

const workAssignmentSchema = z.object({
  primaryIndicator: z.boolean().nullish(),
  jobTitle: z.string().nullish(),
  hireDate: z.string().nullish(),
  terminationDate: z.string().nullish(),
  assignmentStatus: z.object({ statusCode: codeSchema.nullish() }).nullish(),
  homeOrganizationalUnits: z.array(orgUnitSchema).nullish(),
});

const workerSchema = z.object({
  associateOID: z.string().min(1),
  workerStatus: z.object({ statusCode: codeSchema.nullish() }).nullish(),
  person: z
    .object({
      legalName: z
        .object({
          formattedName: z.string().nullish(),
          givenName: z.string().nullish(),
          familyName1: z.string().nullish(),
        })
        .nullish(),
    })
    .nullish(),
  workAssignments: z.array(workAssignmentSchema).nullish(),
});

const amountSchema = z.object({
  amountValue: z.number().nullish(),
  currencyCode: z.string().nullish(),
});

const payrollOutputSchema = z.object({
  payrollGroupCode: z.string().nullish(),
  payrollDate: z.string().nullish(),
  payPeriodStartDate: z.string().nullish(),
  payPeriodEndDate: z.string().nullish(),
  organizationalUnit: codeSchema.nullish(),
  currencyCode: z.string().nullish(),
  employeeCount: z.number().nullish(),
  grossPay: amountSchema.nullish(),
  netPay: amountSchema.nullish(),
  totalTaxes: amountSchema.nullish(),
  totalDeductions: amountSchema.nullish(),
});

type WorkerRecord = z.infer<typeof workerSchema>;
type WorkAssignment = z.infer<typeof workAssignmentSchema>;
type OrgUnit = z.infer<typeof orgUnitSchema>;
type PayrollRecord = z.infer<typeof payrollOutputSchema>;

interface OauthTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export const adpResources = defineResources({
  [WORKER_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Workers from ADP Workforce Now with name, job title, business unit, employment status, hire date, and termination date. Re-fetched in full on every sync.',
    endpoint: 'GET /hr/v2/workers',
    fields: [
      { name: 'name', description: 'Worker legal name.' },
      {
        name: 'jobTitle',
        description: 'Job title on the primary work assignment.',
      },
      {
        name: 'businessUnit',
        description:
          'Home organizational unit on the primary work assignment, used for headcount distributions.',
      },
      {
        name: 'status',
        description:
          'Employment status (e.g. active / terminated / leave), lowercased from the worker status code.',
      },
      {
        name: 'hireDate',
        description: 'Hire date on the primary work assignment (Unix ms).',
      },
      {
        name: 'terminationDate',
        description:
          'Termination date on the primary work assignment (Unix ms; null while active).',
      },
    ],
    responses: { workers: z.array(workerSchema) },
  },
  [PAYROLL_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Employer payroll output per pay group and pay date: gross pay, net pay, total taxes, and total deductions. Synced over a rolling pay-date window and rewritten on every sync.',
    endpoint: 'GET /payroll/v1/payroll-output',
    fields: [
      { name: 'payGroup', description: 'Pay group code for the pay cycle.' },
      {
        name: 'businessUnit',
        description: 'Organizational unit the pay cycle belongs to.',
      },
      { name: 'grossPay', description: 'Total gross pay for the cycle.' },
      { name: 'netPay', description: 'Total net pay for the cycle.' },
      { name: 'taxes', description: 'Total taxes withheld for the cycle.' },
      {
        name: 'deductions',
        description: 'Total deductions for the cycle.',
      },
      { name: 'currency', description: 'Currency code for the amounts.' },
      {
        name: 'employeeCount',
        description: 'Number of employees paid in the cycle.',
      },
      { name: 'payDate', description: 'Pay date of the cycle (Unix ms).' },
    ],
    responses: { payroll_output: z.array(payrollOutputSchema) },
  },
  [PAYROLL_METRIC]: {
    shape: 'metric',
    description:
      'Payroll spend per pay cycle, one sample per amount kind (gross / net / taxes / deductions) with the business unit as a dimension. Derived from the payroll output, not a separate API call.',
    endpoint: 'GET /payroll/v1/payroll-output',
    unit: 'currency',
    notes:
      "Derived from each payroll output record's amounts; the pay date is the sample timestamp. Pay cycles are irregular (weekly / bi-weekly / monthly), so no fixed granularity is declared.",
    dimensions: [
      {
        name: 'kind',
        description: 'Amount kind: "gross", "net", "taxes", or "deductions".',
      },
      {
        name: 'businessUnit',
        description: 'Organizational unit the pay cycle belongs to.',
      },
    ],
    responses: { payroll_output_metrics: z.array(payrollOutputSchema) },
  },
});

function isoToMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function primaryAssignment(worker: WorkerRecord): WorkAssignment | null {
  const assignments = worker.workAssignments ?? [];
  return assignments.find((a) => a.primaryIndicator) ?? assignments[0] ?? null;
}

function workerName(worker: WorkerRecord): string | null {
  const legal = worker.person?.legalName;
  if (!legal) {
    return null;
  }
  if (legal.formattedName) {
    return legal.formattedName;
  }
  const joined = [legal.givenName, legal.familyName1]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ');
  return joined === '' ? null : joined;
}

function orgUnitName(units: OrgUnit[] | null | undefined): string | null {
  const first = (units ?? [])[0];
  return first?.nameCode?.shortName ?? first?.nameCode?.longName ?? null;
}

function statusValue(worker: WorkerRecord): string | null {
  const code =
    worker.workerStatus?.statusCode?.codeValue ??
    primaryAssignment(worker)?.assignmentStatus?.statusCode?.codeValue ??
    null;
  return code ? code.toLowerCase() : null;
}

function amount(value: PayrollRecord['grossPay']): number | null {
  const n = value?.amountValue;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function payrollId(record: PayrollRecord, index: number): string {
  const group = record.payrollGroupCode ?? 'group';
  const date = record.payrollDate ?? String(index);
  return `${group}:${date}`;
}

export const id = 'adp';

export class AdpConnector extends BaseConnector<AdpSettings, AdpCredentials> {
  static readonly id = id;

  static readonly resources = adpResources;

  static readonly schemas = schemasFromResources(adpResources);

  static readonly cost = cost;

  static create(input: unknown, ctx?: ConnectorContext): AdpConnector {
    const parsed = configFields.parse(input);
    return new AdpConnector(
      { lookbackDays: parsed.lookbackDays, resources: parsed.resources },
      {
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
        certPem: parsed.certPem,
        keyPem: parsed.keyPem,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = adpCredentials;

  private accessToken: string | null = null;
  private accessTokenExpiry = 0;

  private async refreshAccessToken(signal?: AbortSignal): Promise<string> {
    const basic = btoa(`${this.creds.clientId}:${this.creds.clientSecret}`);
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
    }).toString();
    const res = await this.post<OauthTokenResponse>(TOKEN_URL, {
      resource: 'oauth_token',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': connectorUserAgent('adp'),
      },
      body,
      signal,
    });
    const token = res.body.access_token;
    const expiresIn = res.body.expires_in ?? 3600;
    this.accessToken = token;
    this.accessTokenExpiry = Date.now() + (expiresIn - 60) * 1000;
    return token;
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (!this.accessToken || Date.now() >= this.accessTokenExpiry) {
      return this.refreshAccessToken(signal);
    }
    return this.accessToken;
  }

  private async apiGet<T>(
    url: string,
    resource: string,
    signal?: AbortSignal,
    retried = false,
  ): Promise<HttpResponse<T>> {
    const token = await this.getAccessToken(signal);
    const res = await this.get<T>(url, {
      resource,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': connectorUserAgent('adp'),
      },
      signal,
    });
    if (res.status === 401 && !retried) {
      this.accessToken = null;
      this.accessTokenExpiry = 0;
      return this.apiGet<T>(url, resource, signal, true);
    }
    return res;
  }

  private parseSkip(page: string | null): number {
    if (!page) {
      return 0;
    }
    const n = Number.parseInt(page, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  private payrollWindowStart(options: SyncOptions): Date {
    const days = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    let start = new Date(Date.now() - days * DAY_MS);
    if (options.since) {
      const sinceMs = Date.parse(options.since);
      if (Number.isFinite(sinceMs) && sinceMs > start.getTime()) {
        start = new Date(sinceMs);
      }
    }
    return start;
  }

  private buildUrl(
    phase: AdpPhase,
    skip: number,
    options: SyncOptions,
  ): string {
    const path =
      phase === 'workers' ? '/hr/v2/workers' : '/payroll/v1/payroll-output';
    const url = new URL(`${API_BASE}${path}`);
    url.searchParams.set('$top', String(PER_PAGE));
    url.searchParams.set('$skip', String(skip));
    if (phase === 'payrolls') {
      url.searchParams.set(
        'payDateFrom',
        yyyymmdd(this.payrollWindowStart(options)),
      );
    }
    return url.toString();
  }

  private extractItems(phase: AdpPhase, body: unknown): unknown[] {
    if (typeof body !== 'object' || body === null) {
      return [];
    }
    const key = phase === 'workers' ? 'workers' : 'payrollOutputs';
    const value = (body as Record<string, unknown>)[key];
    return Array.isArray(value) ? value : [];
  }

  private extractTotal(body: unknown): number | null {
    if (typeof body !== 'object' || body === null) {
      return null;
    }
    const meta = (body as { meta?: { totalNumber?: unknown } }).meta;
    const total = meta?.totalNumber;
    return typeof total === 'number' && Number.isFinite(total) ? total : null;
  }

  private async fetchPhasePage(
    phase: AdpPhase,
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<FetchPageResult<string>> {
    const skip = this.parseSkip(page);
    const url = this.buildUrl(phase, skip, options);
    const res = await this.apiGet<unknown>(url, phase, signal);
    const items = this.extractItems(phase, res.body);
    const total = this.extractTotal(res.body);
    const nextSkip = skip + items.length;
    const hasMore =
      items.length > 0 &&
      nextSkip / PER_PAGE < MAX_PAGES &&
      (total !== null ? nextSkip < total : items.length >= PER_PAGE);
    return { items, next: hasMore ? String(nextSkip) : null };
  }

  private async writeWorkers(
    storage: StorageHandle,
    items: WorkerRecord[],
  ): Promise<void> {
    for (const worker of items) {
      const assignment = primaryAssignment(worker);
      const hireDate = isoToMs(assignment?.hireDate);
      const terminationDate = isoToMs(assignment?.terminationDate);
      await storage.entity({
        type: WORKER_ENTITY,
        id: worker.associateOID,
        attributes: {
          name: workerName(worker),
          jobTitle: assignment?.jobTitle ?? null,
          businessUnit: orgUnitName(assignment?.homeOrganizationalUnits),
          status: statusValue(worker),
          hireDate,
          terminationDate,
        },
        updated_at: terminationDate ?? hireDate ?? 0,
      });
    }
  }

  private async writePayrolls(
    storage: StorageHandle,
    items: PayrollRecord[],
  ): Promise<void> {
    const samples: Array<{
      name: string;
      ts: number;
      value: number;
      attributes: Record<string, string>;
    }> = [];
    let index = 0;
    for (const record of items) {
      const entityId = payrollId(record, index);
      index += 1;
      const payDate = isoToMs(record.payrollDate);
      const businessUnit =
        record.organizationalUnit?.shortName ??
        record.organizationalUnit?.longName ??
        record.organizationalUnit?.codeValue ??
        null;
      const currency =
        record.currencyCode ?? record.grossPay?.currencyCode ?? null;
      const gross = amount(record.grossPay);
      const net = amount(record.netPay);
      const taxes = amount(record.totalTaxes);
      const deductions = amount(record.totalDeductions);
      await storage.entity({
        type: PAYROLL_ENTITY,
        id: entityId,
        attributes: {
          payGroup: record.payrollGroupCode ?? null,
          businessUnit,
          grossPay: gross,
          netPay: net,
          taxes,
          deductions,
          currency,
          employeeCount: record.employeeCount ?? null,
          payDate,
        },
        updated_at: payDate ?? 0,
      });

      if (payDate === null) {
        continue;
      }
      const dimBusinessUnit = businessUnit ?? 'unknown';
      const kinds: Array<[string, number | null]> = [
        ['gross', gross],
        ['net', net],
        ['taxes', taxes],
        ['deductions', deductions],
      ];
      for (const [kind, value] of kinds) {
        if (value === null) {
          continue;
        }
        samples.push({
          name: PAYROLL_METRIC,
          ts: payDate,
          value,
          attributes: { kind, businessUnit: dimBusinessUnit },
        });
      }
    }
    if (samples.length > 0) {
      await storage.metrics(samples, { names: [PAYROLL_METRIC] });
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: AdpPhase,
  ): Promise<void> {
    if (phase === 'workers') {
      await storage.entities([], { types: [WORKER_ENTITY] });
      return;
    }
    await storage.entities([], { types: [PAYROLL_ENTITY] });
    await storage.metrics([], { names: [PAYROLL_METRIC] });
  }

  private async writePhase(
    storage: StorageHandle,
    phase: AdpPhase,
    items: unknown[],
  ): Promise<void> {
    if (phase === 'workers') {
      return this.writeWorkers(storage, items as WorkerRecord[]);
    }
    return this.writePayrolls(storage, items as PayrollRecord[]);
  }

  private resolveCursor(cursor: unknown): AdpSyncCursor | undefined {
    return isAdpSyncCursor(cursor) ? cursor : undefined;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);

    const phases = selectActivePhases<AdpResource, AdpPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<AdpPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) =>
        this.fetchPhasePage(phase, page, options, sig),
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase);
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}
