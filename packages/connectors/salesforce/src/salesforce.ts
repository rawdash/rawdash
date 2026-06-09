import {
  type HttpResponse,
  connectorUserAgent,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
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

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Salesforce',
  category: 'sales',
  brandColor: '#00A1E0',
  tagline:
    'Sync opportunities, opportunity stage-change events, accounts, leads, and users from a Salesforce org for pipeline, forecast, and quota-attainment dashboards.',
  vendor: {
    name: 'Salesforce',
    domain: 'salesforce.com',
    apiDocs:
      'https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/',
    website: 'https://www.salesforce.com',
  },
  auth: {
    summary:
      'OAuth 2.0 with a refresh token issued by a Salesforce Connected App. Requires the consumer key/secret, a refresh token, and the org instance URL.',
    setup: [
      'In Salesforce, go to Setup → App Manager → New Connected App and check "Enable OAuth Settings".',
      'Set the callback URL to a URL you control (e.g. https://localhost:8080/callback); it only has to be reachable when minting the initial refresh token.',
      'Under Selected OAuth Scopes add "Access and manage your data (api)" and "Perform requests on your behalf at any time (refresh_token, offline_access)".',
      'Save, then copy the Consumer Key (client ID) and Consumer Secret from the connected app detail page.',
      'Authorize via https://login.salesforce.com/services/oauth2/authorize?response_type=code&client_id=<KEY>&redirect_uri=<URL> and exchange the resulting code at /services/oauth2/token to obtain a refresh token and the org instance_url.',
      'Use the org instance URL from the token response (e.g. https://mycompany.my.salesforce.com), not login.salesforce.com.',
      'Store the consumer secret and refresh token as rawdash secrets and reference them as secret("SF_CLIENT_SECRET") and secret("SF_REFRESH_TOKEN").',
    ],
  },
  rateLimit:
    'Salesforce caps total API calls per org per 24 hours. Responses include a Sforce-Limit-Info header (api-usage=NN/MM); size sync intervals so the daily budget is not exhausted. The shared HTTP client retries on 429 with Retry-After.',
  limitations: [
    'Custom objects are out of scope for v1; only the standard objects listed above are synced.',
    'Salesforce Marketing Cloud is tracked under a separate connector.',
  ],
});

export interface SalesforceSettings {
  instanceUrl: string;
  apiVersion?: string;
  resources?: readonly SalesforceResource[];
}

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

export const salesforceResources = defineResources({
  salesforce_user: {
    shape: 'entity',
    description:
      'Salesforce users, keyed by user id, with name, email, and active state. Used to attribute opportunities, accounts, and stage changes to owners.',
    endpoint: 'GET /services/data/v{version}/query (SOQL: FROM User)',
    notes: 'Users are backfilled in full on every run; the table is small.',
    fields: [
      { name: 'name', description: 'Full name of the user.' },
      { name: 'email', description: 'User email address.' },
      { name: 'isActive', description: 'Whether the user is active.' },
    ],
    responses: {
      oauth_token: oauthTokenSchema,
      users: z.array(userSchema),
    },
  },
  salesforce_account: {
    shape: 'entity',
    description:
      'Accounts (companies), keyed by account id, with industry, annual revenue, owner, and creation time.',
    endpoint: 'GET /services/data/v{version}/query (SOQL: FROM Account)',
    notes: 'Upserts by id; incremental syncs filter on LastModifiedDate.',
    fields: [
      { name: 'name', description: 'Account name.' },
      { name: 'industry', description: 'Industry classification.' },
      {
        name: 'annualRevenue',
        description: 'Annual revenue in the org currency.',
      },
      { name: 'ownerId', description: 'User id of the account owner.' },
      {
        name: 'createdAt',
        description: 'Account creation time (Unix ms).',
      },
    ],
    responses: { accounts: z.array(accountSchema) },
  },
  salesforce_lead: {
    shape: 'entity',
    description:
      'Leads, keyed by lead id, with email, status, source, and conversion time.',
    endpoint: 'GET /services/data/v{version}/query (SOQL: FROM Lead)',
    notes: 'Upserts by id; incremental syncs filter on LastModifiedDate.',
    fields: [
      { name: 'email', description: 'Lead email address.' },
      { name: 'status', description: 'Lead status.' },
      { name: 'source', description: 'Lead source (LeadSource).' },
      {
        name: 'convertedAt',
        description: 'When the lead was converted (Unix ms), if any.',
      },
      { name: 'createdAt', description: 'Lead creation time (Unix ms).' },
    ],
    responses: { leads: z.array(leadSchema) },
  },
  salesforce_opportunity: {
    shape: 'entity',
    description:
      'Opportunities, keyed by opportunity id, with stage, amount, close date, owner, probability, forecast category, and closed/won flags.',
    endpoint: 'GET /services/data/v{version}/query (SOQL: FROM Opportunity)',
    notes: 'Upserts by id; incremental syncs filter on LastModifiedDate.',
    fields: [
      { name: 'name', description: 'Opportunity name.' },
      { name: 'stage', description: 'Current StageName.' },
      { name: 'amount', description: 'Opportunity amount in org currency.' },
      { name: 'closeDate', description: 'Expected close date (Unix ms).' },
      { name: 'ownerId', description: 'User id of the opportunity owner.' },
      { name: 'probability', description: 'Win probability percentage.' },
      {
        name: 'forecastCategory',
        description: 'Forecast category name.',
      },
      { name: 'isClosed', description: 'Whether the opportunity is closed.' },
      { name: 'isWon', description: 'Whether the opportunity is won.' },
      {
        name: 'createdAt',
        description: 'Opportunity creation time (Unix ms).',
      },
    ],
    responses: { opportunities: z.array(opportunitySchema) },
  },
  salesforce_opportunity_stage_change: {
    shape: 'event',
    description:
      'Opportunity stage transitions derived from OpportunityFieldHistory rows where Field = StageName. One event per transition, timestamped at the change CreatedDate.',
    endpoint:
      "GET /services/data/v{version}/query (SOQL: FROM OpportunityFieldHistory WHERE Field = 'StageName')",
    notes:
      'Stage-change events are immutable; their scope is only cleared on a full sync so an incremental window does not drop history outside its range.',
    fields: [
      {
        name: 'historyId',
        description: 'OpportunityFieldHistory row id.',
      },
      {
        name: 'opportunityId',
        description: 'Id of the opportunity that changed stage.',
      },
      { name: 'fromStage', description: 'Previous StageName (OldValue).' },
      { name: 'toStage', description: 'New StageName (NewValue).' },
      {
        name: 'actorId',
        description: 'User id who made the change (CreatedById).',
      },
    ],
    responses: { opportunity_events: z.array(fieldHistorySchema) },
  },
});

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
    return timestampField
      ? `${base} ORDER BY ${timestampField} ASC`
      : `${base} ORDER BY Id ASC`;
  }
  const literal = soqlDateLiteral(since);
  const connector = base.includes('WHERE') ? 'AND' : 'WHERE';
  return `${base} ${connector} ${timestampField} >= ${literal} ORDER BY ${timestampField} ASC`;
}

function parseDateMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export const id = 'salesforce';

export class SalesforceConnector extends BaseConnector<
  SalesforceSettings,
  SalesforceCredentials
> {
  static readonly id = id;

  static readonly resources = salesforceResources;

  static readonly schemas = schemasFromResources(salesforceResources);

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

  readonly id = id;
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
