import { connectorUserAgent } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorCost,
  type ConnectorDoc,
  type CredentialsSchema,
  type FetchPageResult,
  type JSONValue,
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
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API token',
      description:
        'Deel organization API token with read scopes for people, contracts, and invoices. Generate one in the Deel Developer Center.',
      placeholder: 'deel_...',
      secret: true,
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Invoice lookback days',
      description:
        'How many days of invoices to sync, filtered by issued date. Defaults to 365. Invoices are synced over a rolling window and rewritten on every sync, so invoices issued before the window age out.',
      placeholder: '365',
    }),
    resources: z
      .array(z.enum(['people', 'contracts', 'invoices', 'invoice_events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Deel resources to sync. Omit to sync all of them. 'invoice_events' is derived from the invoices scan, so enabling it without 'invoices' still walks invoices but only writes the payment events.",
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Deel',
  category: 'hr',
  brandColor: '#15D27C',
  tagline:
    'Sync people, contracts, and invoices from Deel for headcount, contractor-spend, and payroll dashboards.',
  vendor: {
    name: 'Deel',
    domain: 'deel.com',
    apiDocs: 'https://developer.deel.com',
    website: 'https://www.deel.com',
  },
  auth: {
    summary:
      'Authenticates with a Deel organization API token sent as a Bearer credential. An organization token is not tied to a user and keeps working when the creating user leaves, so it is the right choice for an unattended sync. The token carries the read scopes selected when it was generated.',
    setup: [
      'Sign in to Deel as an admin and open Apps & Integrations -> Developer Center (older accounts: More -> Developer -> Access Tokens).',
      'Generate a new Organization token, name it, and grant read scopes for People, Contracts, and Invoices.',
      'Copy the token value once on creation - Deel shows it only once.',
      'Store the token as a secret and reference it from config as `apiToken: secret("DEEL_API_TOKEN")`.',
    ],
  },
  rateLimit:
    'Deel enforces 5 requests per second per organization, shared across all tokens, and returns HTTP 429 without rate-limit headers when exceeded. The shared HTTP client retries 429 responses with exponential backoff; keep the sync interval modest so a backfill does not starve other integrations on the same organization.',
  limitations: [
    'Deel does not expose an updated-since filter on the people or contracts list endpoints, so those resources are re-fetched in full on every sync and the stored scope is rewritten each run.',
    'Invoices are synced over a rolling window (lookbackDays back through today, filtered by issued date) and rewritten on every sync, so invoices issued before the window age out of storage.',
  ],
});

export const cost: ConnectorCost = {
  recommendedInterval: '6 hours',
  minInterval: '1 hour',
  warning:
    'Deel is rate-limited to 5 requests / second per organization, shared across every token. People and contracts are re-fetched in full on each sync, so on large workforces a run spans many pages; syncing too often can exhaust the shared quota for other Deel integrations.',
};

export interface DeelSettings {
  lookbackDays?: number;
  resources?: readonly DeelResource[];
}

const deelCredentials = {
  apiToken: {
    description: 'Deel organization API token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type DeelCredentials = typeof deelCredentials;

const PHASE_ORDER = [
  'people',
  'contracts',
  'invoices',
  'invoice_events',
] as const;

type DeelPhase = (typeof PHASE_ORDER)[number];

export type DeelResource = DeelPhase;

const isDeelSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

type DeelSyncCursor = ChunkedSyncCursor<DeelPhase, string>;

const PER_PAGE = 100;
const API_BASE = 'https://api.letsdeel.com/rest/v2';
const DEFAULT_LOOKBACK_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const PERSON_ENTITY = 'deel_person';
const CONTRACT_ENTITY = 'deel_contract';
const INVOICE_ENTITY = 'deel_invoice';
const INVOICE_EVENT = 'deel_invoice_event';

const employmentSchema = z.object({
  id: z.string().nullish(),
  type: z.string().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
});

const personSchema = z.object({
  id: z.string().min(1),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  full_name: z.string().nullish(),
  country: z.string().nullish(),
  job_title: z.string().nullish(),
  start_date: z.string().nullish(),
  hiring_status: z.string().nullish(),
  hiring_type: z.string().nullish(),
  employments: z.array(employmentSchema).nullish(),
});

const compensationSchema = z.object({
  amount: z.string().nullish(),
  currency_code: z.string().nullish(),
  scale: z.string().nullish(),
  frequency: z.string().nullish(),
  gross_annual_salary: z.string().nullish(),
});

const contractSchema = z.object({
  id: z.string().min(1),
  type: z.string().nullish(),
  status: z.string().nullish(),
  created_at: z.string().nullish(),
  start_date: z.string().nullish(),
  updated_at: z.string().nullish(),
  termination_date: z.string().nullish(),
  compensation_details: compensationSchema.nullish(),
});

const invoiceSchema = z.object({
  id: z.string().min(1),
  amount: z.string().nullish(),
  total: z.string().nullish(),
  currency: z.string().nullish(),
  status: z.string().nullish(),
  issued_at: z.string().nullish(),
  created_at: z.string().nullish(),
  paid_at: z.string().nullish(),
  contract_id: z.string().nullish(),
});

type PersonRecord = z.infer<typeof personSchema>;
type ContractRecord = z.infer<typeof contractSchema>;
type InvoiceRecord = z.infer<typeof invoiceSchema>;

export const deelResources = defineResources({
  [PERSON_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Workers on Deel with country, job title, employment type, start date, and current hiring status. Re-fetched in full on every sync.',
    endpoint: 'GET /rest/v2/people',
    fields: [
      { name: 'fullName', description: 'Worker full name.' },
      { name: 'firstName', description: 'Worker first name.' },
      { name: 'lastName', description: 'Worker last name.' },
      {
        name: 'country',
        description: 'Worker country (ISO country name/code).',
      },
      { name: 'jobTitle', description: 'Worker job title.' },
      {
        name: 'employmentType',
        description:
          'Employment / engagement type (e.g. eor, contractor, global_payroll).',
      },
      {
        name: 'status',
        description: 'Hiring status of the worker (e.g. active / inactive).',
      },
      {
        name: 'startDate',
        description: 'When the worker started (Unix ms).',
      },
      {
        name: 'terminationDate',
        description:
          'When the current employment ended (Unix ms; null while active).',
      },
    ],
    responses: { people: z.array(personSchema) },
  },
  [CONTRACT_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Deel contracts with type (eor / contractor / global_payroll / ...), status, and compensation. Re-fetched in full on every sync.',
    endpoint: 'GET /rest/v2/contracts',
    fields: [
      {
        name: 'type',
        description:
          'Contract type (e.g. eor, global_payroll, ongoing_time_based, milestones).',
      },
      { name: 'status', description: 'Contract lifecycle status.' },
      { name: 'rate', description: 'Compensation amount, parsed to a number.' },
      { name: 'currency', description: 'Compensation currency code.' },
      {
        name: 'frequency',
        description: 'Compensation frequency (e.g. monthly, hourly).',
      },
      { name: 'startDate', description: 'Contract start date (Unix ms).' },
      {
        name: 'createdAt',
        description: 'When the contract was created (Unix ms).',
      },
      {
        name: 'terminationDate',
        description: 'When the contract terminated (Unix ms; null if active).',
      },
    ],
    responses: { contracts: z.array(contractSchema) },
  },
  [INVOICE_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Contractor invoices with billed amount, total, currency, and status, linked to their contract. Synced over a rolling issued-date window and rewritten on every sync.',
    endpoint: 'GET /rest/v2/invoices',
    fields: [
      { name: 'amount', description: 'Billed amount, parsed to a number.' },
      {
        name: 'total',
        description:
          'Total charged including fees and VAT, parsed to a number.',
      },
      { name: 'currency', description: 'Invoice currency code.' },
      {
        name: 'status',
        description: 'Invoice status (pending / paid / processing / ...).',
      },
      { name: 'contractId', description: 'Contract the invoice belongs to.' },
      {
        name: 'issuedAt',
        description: 'When the invoice was issued (Unix ms).',
      },
      {
        name: 'paidAt',
        description: 'When the invoice was paid (Unix ms; null if unpaid).',
      },
    ],
    responses: { invoices: z.array(invoiceSchema) },
  },
  [INVOICE_EVENT]: {
    shape: 'event',
    filterable: [],
    description:
      'Invoice lifecycle events (issued / paid) derived from each invoice, carrying the invoice total for spend timeseries. The scope is cleared and rewritten on every sync.',
    endpoint: 'GET /rest/v2/invoices',
    notes:
      "Derived from each invoice's issued_at / paid_at timestamps, not from a separate API call.",
    fields: [
      { name: 'invoiceId', description: 'Invoice the event belongs to.' },
      { name: 'contractId', description: 'Contract id, denormalised.' },
      { name: 'transition', description: '"issued" or "paid".' },
      {
        name: 'amount',
        description: 'Invoice total at the time of the event.',
      },
      { name: 'currency', description: 'Invoice currency code.' },
    ],
    responses: { invoice_events: z.array(invoiceSchema) },
  },
});

interface DeelPageMeta {
  offset?: number | null;
  total_rows?: number | null;
  items_per_page?: number | null;
  cursor?: string | null;
}

interface DeelListResponse<T> {
  data?: T[] | null;
  page?: DeelPageMeta | null;
}

function isoToMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isoToMsOrZero(value: string | null | undefined): number {
  return isoToMs(value) ?? 0;
}

function parseAmount(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fullName(person: PersonRecord): string | null {
  if (person.full_name) {
    return person.full_name;
  }
  const joined = [person.first_name, person.last_name]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ');
  return joined === '' ? null : joined;
}

function currentEmployment(person: PersonRecord) {
  return person.employments?.[0] ?? null;
}

export const id = 'deel';

export class DeelConnector extends BaseConnector<
  DeelSettings,
  DeelCredentials
> {
  static readonly id = id;

  static readonly resources = deelResources;

  static readonly schemas = schemasFromResources(deelResources);

  static readonly cost = cost;

  static create(input: unknown, ctx?: ConnectorContext): DeelConnector {
    const parsed = configFields.parse(input);
    return new DeelConnector(
      { lookbackDays: parsed.lookbackDays, resources: parsed.resources },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = deelCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiToken}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('deel'),
    };
  }

  private apiGet<T>(url: string, resource: string, signal?: AbortSignal) {
    return this.get<DeelListResponse<T>>(url, {
      resource,
      headers: this.buildHeaders(),
      signal,
    });
  }

  private parseOffset(page: string | null): number {
    if (!page) {
      return 0;
    }
    const n = Number.parseInt(page, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  private invoiceWindowStart(): Date {
    const days = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    return new Date(Date.now() - days * DAY_MS);
  }

  private buildUrl(phase: DeelPhase, offset: number): string {
    const path =
      phase === 'people'
        ? '/people'
        : phase === 'contracts'
          ? '/contracts'
          : '/invoices';
    const url = new URL(`${API_BASE}${path}`);
    url.searchParams.set('limit', String(PER_PAGE));
    url.searchParams.set('offset', String(offset));
    if (phase === 'invoices' || phase === 'invoice_events') {
      url.searchParams.set('status', 'all');
      url.searchParams.set(
        'issued_from_date',
        yyyymmdd(this.invoiceWindowStart()),
      );
    }
    return url.toString();
  }

  private async fetchPhasePage(
    phase: DeelPhase,
    page: string | null,
    signal?: AbortSignal,
  ): Promise<FetchPageResult<string>> {
    const offset = this.parseOffset(page);
    const resource = phase === 'invoice_events' ? 'invoice_events' : phase;
    const url = this.buildUrl(phase, offset);
    const res = await this.apiGet<unknown>(url, resource, signal);
    const items = res.body.data ?? [];
    const meta = res.body.page ?? null;
    const perPage = meta?.items_per_page ?? items.length;
    const total = meta?.total_rows ?? null;
    const nextOffset = offset + (perPage > 0 ? perPage : items.length);
    const hasMore =
      items.length > 0 &&
      (total !== null ? nextOffset < total : items.length >= PER_PAGE);
    return { items, next: hasMore ? String(nextOffset) : null };
  }

  private async writePeople(
    storage: StorageHandle,
    items: PersonRecord[],
  ): Promise<void> {
    for (const person of items) {
      const employment = currentEmployment(person);
      await storage.entity({
        type: PERSON_ENTITY,
        id: person.id,
        attributes: {
          fullName: fullName(person),
          firstName: person.first_name ?? null,
          lastName: person.last_name ?? null,
          country: person.country ?? null,
          jobTitle: person.job_title ?? null,
          employmentType: person.hiring_type ?? employment?.type ?? null,
          status: person.hiring_status ?? null,
          startDate: isoToMs(person.start_date ?? employment?.start_date),
          terminationDate: isoToMs(employment?.end_date),
        },
        updated_at: isoToMsOrZero(person.start_date ?? employment?.start_date),
      });
    }
  }

  private async writeContracts(
    storage: StorageHandle,
    items: ContractRecord[],
  ): Promise<void> {
    for (const contract of items) {
      const comp = contract.compensation_details ?? null;
      await storage.entity({
        type: CONTRACT_ENTITY,
        id: contract.id,
        attributes: {
          type: contract.type ?? null,
          status: contract.status ?? null,
          rate: parseAmount(comp?.amount),
          currency: comp?.currency_code ?? null,
          frequency: comp?.frequency ?? null,
          startDate: isoToMs(contract.start_date),
          createdAt: isoToMs(contract.created_at),
          terminationDate: isoToMs(contract.termination_date),
        },
        updated_at: isoToMsOrZero(
          contract.updated_at ?? contract.start_date ?? contract.created_at,
        ),
      });
    }
  }

  private async writeInvoices(
    storage: StorageHandle,
    items: InvoiceRecord[],
  ): Promise<void> {
    for (const invoice of items) {
      await storage.entity({
        type: INVOICE_ENTITY,
        id: invoice.id,
        attributes: {
          amount: parseAmount(invoice.amount),
          total: parseAmount(invoice.total),
          currency: invoice.currency ?? null,
          status: invoice.status ?? null,
          contractId: invoice.contract_id ?? null,
          issuedAt: isoToMs(invoice.issued_at ?? invoice.created_at),
          paidAt: isoToMs(invoice.paid_at),
        },
        updated_at: isoToMsOrZero(
          invoice.paid_at ?? invoice.issued_at ?? invoice.created_at,
        ),
      });
    }
  }

  private async writeInvoiceEvents(
    storage: StorageHandle,
    items: InvoiceRecord[],
  ): Promise<void> {
    for (const invoice of items) {
      const base: Record<string, JSONValue> = {
        invoiceId: invoice.id,
        contractId: invoice.contract_id ?? null,
        amount: parseAmount(invoice.total ?? invoice.amount),
        currency: invoice.currency ?? null,
      };

      const issuedMs = isoToMs(invoice.issued_at ?? invoice.created_at);
      if (issuedMs !== null) {
        await storage.event({
          name: INVOICE_EVENT,
          start_ts: issuedMs,
          end_ts: null,
          attributes: { ...base, transition: 'issued' },
        });
      }

      const paidMs = isoToMs(invoice.paid_at);
      if (paidMs !== null) {
        await storage.event({
          name: INVOICE_EVENT,
          start_ts: paidMs,
          end_ts: null,
          attributes: { ...base, transition: 'paid' },
        });
      }
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: DeelPhase,
  ): Promise<void> {
    if (phase === 'invoice_events') {
      await storage.events([], { names: [INVOICE_EVENT] });
      return;
    }
    const entityType = ENTITY_TYPE_BY_PHASE[phase];
    if (entityType) {
      await storage.entities([], { types: [entityType] });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: DeelPhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'people':
        return this.writePeople(storage, items as PersonRecord[]);
      case 'contracts':
        return this.writeContracts(storage, items as ContractRecord[]);
      case 'invoices':
        return this.writeInvoices(storage, items as InvoiceRecord[]);
      case 'invoice_events':
        return this.writeInvoiceEvents(storage, items as InvoiceRecord[]);
    }
  }

  private resolveCursor(cursor: unknown): DeelSyncCursor | undefined {
    return isDeelSyncCursor(cursor) ? cursor : undefined;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);

    const phases = selectActivePhases<DeelResource, DeelPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<DeelPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) =>
        this.fetchPhasePage(phase, page, sig),
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase);
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}

const ENTITY_TYPE_BY_PHASE: Partial<Record<DeelPhase, string>> = {
  people: PERSON_ENTITY,
  contracts: CONTRACT_ENTITY,
  invoices: INVOICE_ENTITY,
};
