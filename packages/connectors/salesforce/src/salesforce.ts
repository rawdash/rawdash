import {
  type HttpResponse,
  connectorUserAgent,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  makeChunkedCursorGuard,
  paginateChunked,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

export const configFields = defineConfigFields(
  z.object({
    clientId: z.string().min(1).meta({
      label: 'Connected app consumer key',
      description:
        'Consumer key (client ID) of the Salesforce Connected App used for OAuth 2.0 refresh-token exchange.',
      placeholder: '3MVG9...',
    }),
    clientSecret: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Connected app consumer secret',
      description: 'Consumer secret of the Salesforce Connected App.',
      placeholder: 'SF_CLIENT_SECRET',
      secret: true,
    }),
    refreshToken: z.object({ $secret: z.string().min(1) }).meta({
      label: 'OAuth refresh token',
      description:
        'OAuth 2.0 refresh token obtained from the Connected App authorization code flow. Stored as a secret.',
      placeholder: 'SF_REFRESH_TOKEN',
      secret: true,
    }),
    instanceUrl: z.string().url().meta({
      label: 'Instance URL',
      description:
        'Salesforce instance URL, e.g. https://mycompany.my.salesforce.com. Returned alongside the refresh token from the OAuth flow; never use the generic login.salesforce.com URL here.',
      placeholder: 'https://mycompany.my.salesforce.com',
    }),
    apiVersion: z
      .string()
      .regex(/^\d+\.\d+$/)
      .optional()
      .meta({
        label: 'REST API version',
        description:
          'Salesforce REST API version, e.g. "59.0". Defaults to 59.0; bump to pick up newer SOQL semantics.',
        placeholder: '59.0',
      }),
    resources: z
      .array(
        z.enum([
          'users',
          'accounts',
          'leads',
          'opportunities',
          'opportunity_events',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Salesforce resources to sync. Omit to sync all resources. The Connected App only needs read access for the resources listed here.',
      }),
  }),
);

export interface SalesforceSettings {
  instanceUrl: string;
  apiVersion?: string;
  resources?: readonly SalesforceResource[];
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const salesforceCredentials = {
  clientId: {
    description: 'Salesforce Connected App consumer key (client ID)',
    auth: 'required' as const,
  },
  clientSecret: {
    description: 'Salesforce Connected App consumer secret',
    auth: 'required' as const,
  },
  refreshToken: {
    description: 'Salesforce OAuth 2.0 refresh token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type SalesforceCredentials = typeof salesforceCredentials;

// ---------------------------------------------------------------------------
// Phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = [
  'users',
  'accounts',
  'leads',
  'opportunities',
  'opportunity_events',
] as const;

type SalesforcePhase = (typeof PHASE_ORDER)[number];

export type SalesforceResource = SalesforcePhase;

const isSalesforceSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const ENTITY_TYPE_BY_PHASE: Partial<Record<SalesforcePhase, string>> = {
  users: 'salesforce_user',
  accounts: 'salesforce_account',
  leads: 'salesforce_lead',
  opportunities: 'salesforce_opportunity',
};

const STAGE_CHANGE_EVENT = 'salesforce_opportunity_stage_change';

const DEFAULT_API_VERSION = '59.0';

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface QueryResponse<T> {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: T[];
}

interface OauthTokenResponse {
  access_token: string;
  instance_url?: string;
}

interface SalesforceUser {
  Id: string;
  Name: string | null;
  Email: string | null;
  IsActive: boolean;
}

interface SalesforceAccount {
  Id: string;
  Name: string | null;
  Industry: string | null;
  AnnualRevenue: number | null;
  OwnerId: string | null;
  CreatedDate: string;
  LastModifiedDate: string;
}

interface SalesforceLead {
  Id: string;
  Email: string | null;
  Status: string | null;
  LeadSource: string | null;
  ConvertedDate: string | null;
  CreatedDate: string;
  LastModifiedDate: string;
}

interface SalesforceOpportunity {
  Id: string;
  Name: string | null;
  StageName: string | null;
  Amount: number | null;
  CloseDate: string | null;
  OwnerId: string | null;
  Probability: number | null;
  ForecastCategoryName: string | null;
  IsClosed: boolean;
  IsWon: boolean;
  CreatedDate: string;
  LastModifiedDate: string;
}

interface SalesforceFieldHistory {
  Id: string;
  OpportunityId: string;
  Field: string;
  OldValue: string | null;
  NewValue: string | null;
  CreatedDate: string;
  CreatedById: string | null;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const idString = z.string().min(1);
const isoDate = z.string().min(1);

const oauthTokenSchema = z.object({
  access_token: z.string().min(1),
  instance_url: z.string().optional(),
});

const userSchema = z.object({
  Id: idString,
  Name: z.string().nullable(),
  Email: z.string().nullable(),
  IsActive: z.boolean(),
});

const accountSchema = z.object({
  Id: idString,
  Name: z.string().nullable(),
  Industry: z.string().nullable(),
  AnnualRevenue: z.number().nullable(),
  OwnerId: z.string().nullable(),
  CreatedDate: isoDate,
  LastModifiedDate: isoDate,
});

const leadSchema = z.object({
  Id: idString,
  Email: z.string().nullable(),
  Status: z.string().nullable(),
  LeadSource: z.string().nullable(),
  ConvertedDate: z.string().nullable(),
  CreatedDate: isoDate,
  LastModifiedDate: isoDate,
});

const opportunitySchema = z.object({
  Id: idString,
  Name: z.string().nullable(),
  StageName: z.string().nullable(),
  Amount: z.number().nullable(),
  CloseDate: z.string().nullable(),
  OwnerId: z.string().nullable(),
  Probability: z.number().nullable(),
  ForecastCategoryName: z.string().nullable(),
  IsClosed: z.boolean(),
  IsWon: z.boolean(),
  CreatedDate: isoDate,
  LastModifiedDate: isoDate,
});

const fieldHistorySchema = z.object({
  Id: idString,
  OpportunityId: idString,
  Field: z.string(),
  OldValue: z.string().nullable(),
  NewValue: z.string().nullable(),
  CreatedDate: isoDate,
  CreatedById: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// SOQL helpers
// ---------------------------------------------------------------------------

const PHASE_SOQL: Record<SalesforcePhase, string> = {
  users: 'SELECT Id, Name, Email, IsActive FROM User',
  accounts:
    'SELECT Id, Name, Industry, AnnualRevenue, OwnerId, CreatedDate, LastModifiedDate FROM Account',
  leads:
    'SELECT Id, Email, Status, LeadSource, ConvertedDate, CreatedDate, LastModifiedDate FROM Lead',
  opportunities:
    'SELECT Id, Name, StageName, Amount, CloseDate, OwnerId, Probability, ForecastCategoryName, IsClosed, IsWon, CreatedDate, LastModifiedDate FROM Opportunity',
  opportunity_events:
    "SELECT Id, OpportunityId, Field, OldValue, NewValue, CreatedDate, CreatedById FROM OpportunityFieldHistory WHERE Field = 'StageName'",
};

const PHASE_TIMESTAMP: Record<SalesforcePhase, string> = {
  users: '',
  accounts: 'LastModifiedDate',
  leads: 'LastModifiedDate',
  opportunities: 'LastModifiedDate',
  opportunity_events: 'CreatedDate',
};

// Salesforce SOQL accepts ISO 8601 date-time literals without quotes
// (e.g. 2024-01-01T00:00:00Z). Numeric milliseconds get stripped because the
// reference grammar specifies whole-second precision for date-time literals.
function soqlDateLiteral(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return `${d.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
}

function buildPhaseSoql(
  phase: SalesforcePhase,
  since: string | undefined,
): string {
  const base = PHASE_SOQL[phase];
  const timestampField = PHASE_TIMESTAMP[phase];
  if (!timestampField || !since) {
    // Users have no LastModifiedDate filter on a per-row basis here; full
    // SOQL is cheap and the table is small enough that a backfill on every
    // tick is fine.
    return timestampField
      ? `${base} ORDER BY ${timestampField} ASC`
      : `${base} ORDER BY Id ASC`;
  }
  const literal = soqlDateLiteral(since);
  const connector = base.includes('WHERE') ? 'AND' : 'WHERE';
  return `${base} ${connector} ${timestampField} >= ${literal} ORDER BY ${timestampField} ASC`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDateMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// SalesforceConnector
// ---------------------------------------------------------------------------

export class SalesforceConnector extends BaseConnector<
  SalesforceSettings,
  SalesforceCredentials
> {
  static readonly id = 'salesforce';

  static readonly schemas = {
    oauth_token: oauthTokenSchema,
    users: z.array(userSchema),
    accounts: z.array(accountSchema),
    leads: z.array(leadSchema),
    opportunities: z.array(opportunitySchema),
    opportunity_events: z.array(fieldHistorySchema),
  } as const;

  static create(input: unknown, ctx?: ConnectorContext): SalesforceConnector {
    const parsed = configFields.parse(input);
    return new SalesforceConnector(
      {
        instanceUrl: parsed.instanceUrl,
        apiVersion: parsed.apiVersion,
        resources: parsed.resources,
      },
      {
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
        refreshToken: parsed.refreshToken,
      },
      ctx,
    );
  }

  readonly id = 'salesforce';
  override readonly credentials = salesforceCredentials;

  private accessToken: string | null = null;

  private apiVersion(): string {
    return this.settings.apiVersion ?? DEFAULT_API_VERSION;
  }

  private baseUrl(): string {
    return this.settings.instanceUrl.replace(/\/+$/, '');
  }

  private async refreshAccessToken(signal?: AbortSignal): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      refresh_token: this.creds.refreshToken,
    }).toString();
    const res = await this.post<OauthTokenResponse>(
      `${this.baseUrl()}/services/oauth2/token`,
      {
        resource: 'oauth_token',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': connectorUserAgent('salesforce'),
        },
        body,
        signal,
      },
    );
    return res.body.access_token;
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (!this.accessToken) {
      this.accessToken = await this.refreshAccessToken(signal);
    }
    return this.accessToken;
  }

  private async apiGet<T>(
    pathOrUrl: string,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    const url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.baseUrl()}${pathOrUrl}`;
    const token = await this.getAccessToken(signal);
    return this.get<T>(url, {
      resource,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': connectorUserAgent('salesforce'),
      },
      signal,
    });
  }

  // Salesforce returns nextRecordsUrl as a path like
  // "/services/data/v59.0/query/01g...-2000". We pass the path back through
  // the cursor verbatim; defensively strip the origin if the server ever
  // returns an absolute URL so the cursor cannot exfiltrate credentials to
  // an attacker-controlled host.
  private sanitizeNextRecordsUrl(value: string | undefined): string | null {
    if (!value) {
      return null;
    }
    if (value.startsWith('/services/data/')) {
      return value;
    }
    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith('/services/data/')) {
        return parsed.pathname + parsed.search;
      }
    } catch {
      // ignore — fall through
    }
    return null;
  }

  private async fetchPage(
    phase: SalesforcePhase,
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: unknown[]; next: string | null }> {
    let path: string;
    if (page) {
      // Resumed cursor pages may have been tampered with; re-run them through
      // the same allowlist used for fresh nextRecordsUrl values so a forged
      // absolute URL can never carry the bearer token to an unintended host.
      const safePage = this.sanitizeNextRecordsUrl(page);
      if (!safePage) {
        throw new Error(`Invalid Salesforce cursor page: ${page}`);
      }
      path = safePage;
    } else {
      const soql = buildPhaseSoql(phase, options.since);
      const url = new URL(
        `${this.baseUrl()}/services/data/v${this.apiVersion()}/query`,
      );
      url.searchParams.set('q', soql);
      path = `${url.pathname}?${url.searchParams.toString()}`;
    }
    const res = await this.apiGet<QueryResponse<unknown>>(path, phase, signal);
    return {
      items: res.body.records,
      next: res.body.done
        ? null
        : this.sanitizeNextRecordsUrl(res.body.nextRecordsUrl),
    };
  }

  // ---------------------------------------------------------------------------
  // Writers
  // ---------------------------------------------------------------------------

  private async writeUsers(
    storage: StorageHandle,
    items: SalesforceUser[],
  ): Promise<void> {
    for (const u of items) {
      await storage.entity({
        type: 'salesforce_user',
        id: u.Id,
        attributes: {
          name: u.Name,
          email: u.Email,
          isActive: u.IsActive,
        },
        updated_at: 0,
      });
    }
  }

  private async writeAccounts(
    storage: StorageHandle,
    items: SalesforceAccount[],
  ): Promise<void> {
    for (const a of items) {
      await storage.entity({
        type: 'salesforce_account',
        id: a.Id,
        attributes: {
          name: a.Name,
          industry: a.Industry,
          annualRevenue: a.AnnualRevenue,
          ownerId: a.OwnerId,
          createdAt: parseDateMs(a.CreatedDate),
        },
        updated_at: parseDateMs(a.LastModifiedDate) ?? 0,
      });
    }
  }

  private async writeLeads(
    storage: StorageHandle,
    items: SalesforceLead[],
  ): Promise<void> {
    for (const l of items) {
      await storage.entity({
        type: 'salesforce_lead',
        id: l.Id,
        attributes: {
          email: l.Email,
          status: l.Status,
          source: l.LeadSource,
          convertedAt: parseDateMs(l.ConvertedDate),
          createdAt: parseDateMs(l.CreatedDate),
        },
        updated_at: parseDateMs(l.LastModifiedDate) ?? 0,
      });
    }
  }

  private async writeOpportunities(
    storage: StorageHandle,
    items: SalesforceOpportunity[],
  ): Promise<void> {
    for (const o of items) {
      await storage.entity({
        type: 'salesforce_opportunity',
        id: o.Id,
        attributes: {
          name: o.Name,
          stage: o.StageName,
          amount: o.Amount,
          closeDate: parseDateMs(o.CloseDate),
          ownerId: o.OwnerId,
          probability: o.Probability,
          forecastCategory: o.ForecastCategoryName,
          isClosed: o.IsClosed,
          isWon: o.IsWon,
          createdAt: parseDateMs(o.CreatedDate),
        },
        updated_at: parseDateMs(o.LastModifiedDate) ?? 0,
      });
    }
  }

  private async writeOpportunityEvents(
    storage: StorageHandle,
    items: SalesforceFieldHistory[],
  ): Promise<void> {
    for (const h of items) {
      const ts = parseDateMs(h.CreatedDate);
      if (ts === null) {
        continue;
      }
      await storage.event({
        name: STAGE_CHANGE_EVENT,
        start_ts: ts,
        end_ts: null,
        attributes: {
          historyId: h.Id,
          opportunityId: h.OpportunityId,
          fromStage: h.OldValue,
          toStage: h.NewValue,
          actorId: h.CreatedById,
        },
      });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: SalesforcePhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'users':
        return this.writeUsers(storage, items as SalesforceUser[]);
      case 'accounts':
        return this.writeAccounts(storage, items as SalesforceAccount[]);
      case 'leads':
        return this.writeLeads(storage, items as SalesforceLead[]);
      case 'opportunities':
        return this.writeOpportunities(
          storage,
          items as SalesforceOpportunity[],
        );
      case 'opportunity_events':
        return this.writeOpportunityEvents(
          storage,
          items as SalesforceFieldHistory[],
        );
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: SalesforcePhase,
    isFull: boolean,
  ): Promise<void> {
    if (phase === 'opportunity_events') {
      // Stage-change events are immutable; only clear on a full sync so an
      // incremental window doesn't drop history outside its range.
      if (isFull) {
        await storage.events([], { names: [STAGE_CHANGE_EVENT] });
      }
      return;
    }
    if (!isFull) {
      return;
    }
    const entityType = ENTITY_TYPE_BY_PHASE[phase];
    if (entityType) {
      await storage.entities([], { types: [entityType] });
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isSalesforceSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<SalesforceResource, SalesforcePhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<SalesforcePhase, string>({
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
