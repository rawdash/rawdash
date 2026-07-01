import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
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
    devKey: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Developer key',
      description:
        'BILL developer key that authorizes API access for your app. Find it in the BILL Developer portal under your app.',
      placeholder: 'BILL_DEV_KEY',
      secret: true,
    }),
    username: z.string().min(1).meta({
      label: 'Username',
      description:
        'Email address of the BILL user the API signs in as. This user must have access to the organization you are syncing.',
      placeholder: 'api-user@example.com',
    }),
    password: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Password',
      description: 'Password for the BILL user. Stored as a secret.',
      placeholder: 'BILL_PASSWORD',
      secret: true,
    }),
    orgId: z.string().min(1).meta({
      label: 'Organization ID',
      description:
        'BILL organization ID to sync. Find it in the BILL app URL or via the List Organizations API.',
      placeholder: '00801ABCDEFGHIJKLMNO',
    }),
    resources: z
      .array(z.enum(['bills', 'vendors', 'payments']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which BILL resources to sync. Omit to sync all of them (bills, vendors, payments).',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Bill.com',
  category: 'finance',
  brandColor: '#005DAA',
  tagline:
    'Sync accounts-payable bills, vendors, and vendor payments from BILL (Bill.com) for AP aging, bills-pending, and vendor-spend dashboards.',
  vendor: {
    name: 'Bill.com',
    domain: 'bill.com',
    apiDocs: 'https://developer.bill.com/docs/home',
    website: 'https://www.bill.com',
  },
  auth: {
    summary:
      'Session-based sign in against the BILL v3 API. The connector signs in with a developer key, username, password, and organization ID to obtain a session, then reuses it for the rest of the sync.',
    setup: [
      'Request a BILL developer key from the BILL Developer portal and note the key value.',
      'Create or choose a BILL user with access to the organization you want to sync.',
      'Find the organization ID for that organization (visible in the app URL or via the List Organizations API).',
      'Store the developer key and the user password as rawdash secrets and reference them from the connector config as `devKey: secret("BILL_DEV_KEY")` and `password: secret("BILL_PASSWORD")`.',
    ],
  },
  rateLimit:
    'BILL does not publish standard rate-limit response headers; the shared HTTP client retries 429 responses with exponential backoff. Sessions expire after 35 minutes of inactivity and are transparently re-established on a 401.',
  limitations: [
    'Monetary amounts are stored in major currency units (e.g. dollars), matching the BILL API, not in the smallest unit.',
    'Incremental syncs filter on updatedTime, so status transitions (a bill moving from UNPAID to PAID) are picked up on the next run.',
    'The set of synced resources is controlled by the `resources` config field; omit it to sync all of them.',
    'Bill line items and approval workflow detail are out of scope; only the header-level bill, its vendor, and vendor payments are synced.',
  ],
});

export type BillResource = 'bills' | 'vendors' | 'payments';

export interface BillSettings {
  orgId: string;
  resources?: readonly BillResource[];
}

const billCredentials = {
  devKey: {
    description: 'BILL developer key',
    auth: 'required' as const,
  },
  username: {
    description: 'BILL user email',
    auth: 'required' as const,
  },
  password: {
    description: 'BILL user password',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type BillCredentials = typeof billCredentials;

const API_BASE = 'https://gateway.prod.bill.com/connect/v3';
const PAGE_SIZE = 100;

const PHASE_ORDER = ['vendors', 'bills', 'payments'] as const;

type BillPhase = (typeof PHASE_ORDER)[number];

type BillSyncCursor = ChunkedSyncCursor<BillPhase, string>;

const isBillSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const VENDOR_ENTITY = 'bill_vendor';
const BILL_ENTITY = 'bill_bill';
const PAYMENT_EVENT = 'bill_payment';

const ENDPOINT_BY_PHASE: Record<BillPhase, string> = {
  vendors: 'vendors',
  bills: 'bills',
  payments: 'payments',
};

function isAuthError(err: unknown): boolean {
  return err instanceof Error && (err as { kind?: unknown }).kind === 'auth';
}

const idString = z.string().min(1);

const loginSchema = z.object({
  sessionId: idString,
  organizationId: z.string().nullish(),
  userId: z.string().nullish(),
});

const vendorSchema = z.object({
  id: idString,
  name: z.string().nullish(),
  email: z.string().nullish(),
  accountNumber: z.string().nullish(),
  phone: z.string().nullish(),
  archived: z.boolean().nullish(),
  billCurrency: z.string().nullish(),
  createdTime: z.string().nullish(),
  updatedTime: z.string().nullish(),
});

const billSchema = z.object({
  id: idString,
  vendorId: z.string().nullish(),
  amount: z.number().nullish(),
  dueDate: z.string().nullish(),
  invoice: z
    .object({
      invoiceNumber: z.string().nullish(),
      invoiceDate: z.string().nullish(),
    })
    .nullish(),
  paymentStatus: z.string().nullish(),
  approvalStatus: z.string().nullish(),
  archived: z.boolean().nullish(),
  createdTime: z.string().nullish(),
  updatedTime: z.string().nullish(),
});

const paymentSchema = z.object({
  id: idString,
  vendorId: z.string().nullish(),
  billId: z.string().nullish(),
  amount: z.number().nullish(),
  processDate: z.string().nullish(),
  status: z.string().nullish(),
  description: z.string().nullish(),
  createdTime: z.string().nullish(),
  updatedTime: z.string().nullish(),
});

const listResponseSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    results: z.array(item),
    nextPage: z.string().nullish(),
    prevPage: z.string().nullish(),
  });

const vendorsListSchema = listResponseSchema(vendorSchema);
const billsListSchema = listResponseSchema(billSchema);
const paymentsListSchema = listResponseSchema(paymentSchema);

export const billResources = defineResources({
  [VENDOR_ENTITY]: {
    shape: 'entity',
    filterable: [{ field: 'archived', ops: ['eq'], values: ['true', 'false'] }],
    description:
      'Vendors (suppliers) with name, contact details, account number, and archived state.',
    endpoint: 'GET /v3/vendors',
    notes:
      'Incremental syncs filter on updatedTime and sort ascending so resumable pages stay ordered.',
    fields: [
      { name: 'name', description: 'Vendor display name.' },
      { name: 'email', description: 'Vendor contact email, if set.' },
      {
        name: 'accountNumber',
        description: 'Your account number with the vendor, if set.',
      },
      { name: 'phone', description: 'Vendor phone number, if set.' },
      {
        name: 'archived',
        description: 'Whether the vendor has been archived.',
      },
      {
        name: 'billCurrency',
        description: 'Default bill currency for the vendor (ISO code).',
      },
      {
        name: 'createdAt',
        description: 'When the vendor was created (Unix ms).',
      },
    ],
    responses: {
      login: loginSchema,
      vendors: vendorsListSchema,
    },
  },
  [BILL_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'paymentStatus',
        ops: ['eq'],
        values: [
          'UNPAID',
          'PARTIALLY_PAID',
          'PAID',
          'SCHEDULED',
          'PARTIALLY_SCHEDULED',
        ],
      },
    ],
    description:
      'Accounts-payable bills with vendor, invoice number, invoice and due dates, amount, and payment status.',
    endpoint: 'GET /v3/bills',
    notes:
      'Amounts are in the bill currency major units (e.g. dollars). Incremental syncs filter on updatedTime so status transitions are re-fetched.',
    fields: [
      { name: 'vendorId', description: 'Vendor the bill is owed to.' },
      { name: 'invoiceNumber', description: 'Vendor invoice number, if set.' },
      {
        name: 'invoiceDate',
        description: 'Invoice date (Unix ms), if set.',
      },
      { name: 'dueDate', description: 'Payment due date (Unix ms), if set.' },
      {
        name: 'amount',
        description: 'Bill total in the bill currency major units.',
      },
      {
        name: 'paymentStatus',
        description: 'Payment status (UNPAID, PARTIALLY_PAID, PAID, ...).',
      },
      {
        name: 'approvalStatus',
        description: 'Approval status (UNASSIGNED, APPROVED, ...), if set.',
      },
      { name: 'archived', description: 'Whether the bill has been archived.' },
      {
        name: 'createdAt',
        description: 'When the bill was created (Unix ms).',
      },
    ],
    responses: { bills: billsListSchema },
  },
  [PAYMENT_EVENT]: {
    shape: 'event',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: ['SCHEDULED', 'PAID', 'CANCELED'],
      },
    ],
    description:
      'Vendor payments (money sent to vendors), one event per payment timestamped at its process date.',
    endpoint: 'GET /v3/payments',
    fields: [
      { name: 'id', description: 'BILL payment id.' },
      { name: 'vendorId', description: 'Vendor paid, if set.' },
      { name: 'billId', description: 'Bill the payment applies to, if set.' },
      {
        name: 'amount',
        description: 'Payment amount in the payment currency major units.',
      },
      {
        name: 'status',
        description: 'Payment status (SCHEDULED, PAID, CANCELED).',
      },
      { name: 'description', description: 'Payment description, if set.' },
      {
        name: 'processDate',
        description: 'Scheduled or actual process date (Unix ms), if set.',
      },
    ],
    responses: { payments: paymentsListSchema },
  },
});

export const id = 'bill';

type BillLogin = z.infer<typeof loginSchema>;
type BillVendor = z.infer<typeof vendorSchema>;
type BillBill = z.infer<typeof billSchema>;
type BillPayment = z.infer<typeof paymentSchema>;

interface BillListResponse<T> {
  results: T[];
  nextPage?: string | null;
  prevPage?: string | null;
}

export class BillConnector extends BaseConnector<
  BillSettings,
  BillCredentials
> {
  static readonly id = id;

  static readonly resources = billResources;

  static readonly schemas = schemasFromResources(billResources);

  static create(input: unknown, ctx?: ConnectorContext): BillConnector {
    const parsed = configFields.parse(input);
    return new BillConnector(
      { orgId: parsed.orgId, resources: parsed.resources },
      {
        devKey: parsed.devKey,
        username: parsed.username,
        password: parsed.password,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = billCredentials;

  private sessionId: string | null = null;

  private baseHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': connectorUserAgent('bill'),
    };
  }

  private async refreshSession(signal?: AbortSignal): Promise<string> {
    const res = await this.post<BillLogin>(`${API_BASE}/login`, {
      resource: 'login',
      headers: this.baseHeaders(),
      body: JSON.stringify({
        username: this.creds.username,
        password: this.creds.password,
        organizationId: this.settings.orgId,
        devKey: this.creds.devKey,
      }),
      signal,
    });
    const sessionId = res.body.sessionId;
    if (!sessionId) {
      throw new Error('BILL login did not return a sessionId');
    }
    this.sessionId = sessionId;
    return sessionId;
  }

  private async getSession(signal?: AbortSignal): Promise<string> {
    if (this.sessionId) {
      return this.sessionId;
    }
    return this.refreshSession(signal);
  }

  private async apiGet<T>(
    url: string,
    resource: string,
    signal?: AbortSignal,
    retried = false,
  ): Promise<HttpResponse<T>> {
    const sessionId = await this.getSession(signal);
    try {
      return await this.get<T>(url, {
        resource,
        headers: {
          ...this.baseHeaders(),
          sessionId,
          devKey: this.creds.devKey,
        },
        signal,
      });
    } catch (err) {
      if (!retried && isAuthError(err)) {
        this.sessionId = null;
        return this.apiGet<T>(url, resource, signal, true);
      }
      throw err;
    }
  }

  private buildListUrl(
    phase: BillPhase,
    page: string | null,
    options: SyncOptions,
  ): string {
    const url = new URL(`${API_BASE}/${ENDPOINT_BY_PHASE[phase]}`);
    url.searchParams.set('max', String(PAGE_SIZE));
    if (page) {
      url.searchParams.set('page', page);
      return url.toString();
    }
    url.searchParams.set('sort', 'updatedTime:asc');
    if (options.since) {
      const iso = new Date(options.since).toISOString();
      url.searchParams.set('filters', `updatedTime:gte:"${iso}"`);
    }
    return url.toString();
  }

  private async fetchPage(
    phase: BillPhase,
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const url = this.buildListUrl(phase, page, options);
    const res = await this.apiGet<BillListResponse<{ id: string }>>(
      url,
      phase,
      signal,
    );
    const results = res.body.results ?? [];
    const nextPage = res.body.nextPage ?? null;
    const next = nextPage && results.length > 0 ? nextPage : null;
    return { items: results, next };
  }

  private async writeVendors(
    storage: StorageHandle,
    items: BillVendor[],
  ): Promise<void> {
    for (const v of items) {
      const createdMs = parseEpoch(v.createdTime ?? null, 'iso');
      const updatedMs = parseEpoch(v.updatedTime ?? null, 'iso');
      await storage.entity({
        type: VENDOR_ENTITY,
        id: v.id,
        attributes: {
          name: v.name ?? null,
          email: v.email ?? null,
          accountNumber: v.accountNumber ?? null,
          phone: v.phone ?? null,
          archived: v.archived ?? false,
          billCurrency: v.billCurrency ?? null,
          createdAt: createdMs,
        },
        updated_at: updatedMs ?? createdMs ?? 0,
      });
    }
  }

  private async writeBills(
    storage: StorageHandle,
    items: BillBill[],
  ): Promise<void> {
    for (const b of items) {
      const createdMs = parseEpoch(b.createdTime ?? null, 'iso');
      const updatedMs = parseEpoch(b.updatedTime ?? null, 'iso');
      await storage.entity({
        type: BILL_ENTITY,
        id: b.id,
        attributes: {
          vendorId: b.vendorId ?? null,
          invoiceNumber: b.invoice?.invoiceNumber ?? null,
          invoiceDate: parseEpoch(b.invoice?.invoiceDate ?? null, 'iso'),
          dueDate: parseEpoch(b.dueDate ?? null, 'iso'),
          amount: b.amount ?? null,
          paymentStatus: b.paymentStatus ?? null,
          approvalStatus: b.approvalStatus ?? null,
          archived: b.archived ?? false,
          createdAt: createdMs,
        },
        updated_at: updatedMs ?? createdMs ?? 0,
      });
    }
  }

  private async writePayments(
    storage: StorageHandle,
    items: BillPayment[],
  ): Promise<void> {
    for (const p of items) {
      const createdMs = parseEpoch(p.createdTime ?? null, 'iso');
      const processMs = parseEpoch(p.processDate ?? null, 'iso');
      const ts = processMs ?? createdMs;
      if (ts === null) {
        continue;
      }
      await storage.event({
        name: PAYMENT_EVENT,
        start_ts: ts,
        end_ts: null,
        attributes: {
          id: p.id,
          vendorId: p.vendorId ?? null,
          billId: p.billId ?? null,
          amount: p.amount ?? null,
          status: p.status ?? null,
          description: p.description ?? null,
          processDate: processMs,
        },
      });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: BillPhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'vendors':
        return this.writeVendors(storage, items as BillVendor[]);
      case 'bills':
        return this.writeBills(storage, items as BillBill[]);
      case 'payments':
        return this.writePayments(storage, items as BillPayment[]);
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: BillPhase,
    isFull: boolean,
  ): Promise<void> {
    if (!isFull) {
      return;
    }
    switch (phase) {
      case 'vendors':
        await storage.entities([], { types: [VENDOR_ENTITY] });
        return;
      case 'bills':
        await storage.entities([], { types: [BILL_ENTITY] });
        return;
      case 'payments':
        await storage.events([], { names: [PAYMENT_EVENT] });
        return;
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor: BillSyncCursor | undefined = isBillSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<BillResource, BillPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<BillPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: (phase, page, sig) =>
        this.fetchPage(phase, page, options, sig),
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}
