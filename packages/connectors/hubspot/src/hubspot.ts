import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  type AggregateRequest,
  type AggregateValue,
  BaseConnector,
  type ConnectorContext,
  type CredentialsSchema,
  type FilterClause,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  makeChunkedCursorGuard,
  paginateChunked,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    accessToken: z.object({ $secret: z.string() }).meta({
      label: 'Private App access token',
      description:
        'HubSpot private app access token with read scopes for contacts, companies, deals, and marketing email. Create one at Settings → Integrations → Private Apps.',
      placeholder: 'pat-na1-...',
      secret: true,
    }),
    resources: z
      .array(
        z.enum([
          'contacts',
          'companies',
          'deals',
          'deal_events',
          'email_campaigns',
          'email_stats',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which HubSpot resources to sync. Omit to sync all resources. The access token only needs read scopes for the resources listed here.',
      }),
  }),
);

export interface HubSpotSettings {
  resources?: readonly HubSpotResource[];
}

// ---------------------------------------------------------------------------
// HubSpot API types
// ---------------------------------------------------------------------------

type HubSpotProperties = Record<string, string | null | undefined>;

interface CrmRecord {
  id: string;
  properties: HubSpotProperties;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

interface CrmSearchResponse {
  total?: number;
  results: CrmRecord[];
  paging?: { next?: { after?: string } };
}

interface CrmListResponse {
  results: DealHistoryRecord[];
  paging?: { next?: { after?: string } };
}

interface DealHistoryEntry {
  value?: string | null;
  timestamp?: string | null;
  sourceType?: string | null;
}

interface DealHistoryRecord {
  id: string;
  propertiesWithHistory?: {
    dealstage?: DealHistoryEntry[];
  };
}

interface CampaignListResponse {
  campaigns: Array<{ id: number | string }>;
  hasMore?: boolean;
  offset?: number | string;
}

interface CampaignCounters {
  sent?: number;
  delivered?: number;
  open?: number;
  click?: number;
  bounce?: number;
  unsubscribed?: number;
}

interface CampaignDetail {
  id: number | string;
  name?: string | null;
  subject?: string | null;
  fromName?: string | null;
  type?: string | null;
  lastProcessingFinishedAt?: number | string | null;
  numIncluded?: number | null;
  counters?: CampaignCounters;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const hubspotCredentials = {
  accessToken: {
    description: 'HubSpot private app access token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type HubSpotCredentials = typeof hubspotCredentials;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = [
  'contacts',
  'companies',
  'deals',
  'deal_events',
  'email_campaigns',
  'email_stats',
] as const;

type HubSpotPhase = (typeof PHASE_ORDER)[number];

export type HubSpotResource = HubSpotPhase;

const isHubSpotSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const BASE_URL = 'https://api.hubapi.com';
const SEARCH_LIMIT = 100;
const LIST_LIMIT = 100;

type CrmObjectPhase = 'contacts' | 'companies' | 'deals';

// CRM object name + property names requested per search phase.
const SEARCH_PROPERTIES: Record<CrmObjectPhase, readonly string[]> = {
  contacts: [
    'email',
    'lifecyclestage',
    'hs_lead_status',
    'createdate',
    'lastmodifieddate',
    'hubspot_owner_id',
  ],
  companies: [
    'name',
    'domain',
    'industry',
    'createdate',
    'lifecyclestage',
    'hs_lastmodifieddate',
  ],
  deals: [
    'dealname',
    'dealstage',
    'pipeline',
    'amount',
    'closedate',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
  ],
};

// Property each CRM object stamps with its last-modified time, used both for
// the incremental `since` filter and the entity `updated_at` fallback.
const MODIFIED_PROPERTY: Record<CrmObjectPhase, string> = {
  contacts: 'lastmodifieddate',
  companies: 'hs_lastmodifieddate',
  deals: 'hs_lastmodifieddate',
};

const ENTITY_TYPE_BY_PHASE: Partial<Record<HubSpotPhase, string>> = {
  contacts: 'hubspot_contact',
  companies: 'hubspot_company',
  deals: 'hubspot_deal',
  email_campaigns: 'hubspot_email_campaign',
};

const DEAL_STAGE_EVENT = 'hubspot_deal_stage_change';
const EMAIL_STATS_METRIC = 'hubspot_email_stats';

// Aggregate `resource` (the widget's entity type) → CRM search object.
const COUNT_RESOURCE_TO_OBJECT: Record<string, CrmObjectPhase> = {
  hubspot_contact: 'contacts',
  hubspot_company: 'companies',
  hubspot_deal: 'deals',
};

const FILTER_OP_TO_HUBSPOT: Record<string, string> = {
  eq: 'EQ',
  neq: 'NEQ',
  gt: 'GT',
  gte: 'GTE',
  lt: 'LT',
  lte: 'LTE',
  contains: 'CONTAINS_TOKEN',
};

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function finiteNumberOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function counterValue(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function unsupportedAggregate(req: AggregateRequest): Error {
  return new Error(
    `HubSpot aggregate: unsupported ${req.fn} for resource=${req.resource}`,
  );
}

// ---------------------------------------------------------------------------
// Schemas — describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const idString = z.string().min(1);

const contactProperties = z.object({
  email: z.string().nullish(),
  lifecyclestage: z.string().nullish(),
  hs_lead_status: z.string().nullish(),
  createdate: z.string().nullish(),
  lastmodifieddate: z.string().nullish(),
  hubspot_owner_id: z.string().nullish(),
});

const companyProperties = z.object({
  name: z.string().nullish(),
  domain: z.string().nullish(),
  industry: z.string().nullish(),
  createdate: z.string().nullish(),
  lifecyclestage: z.string().nullish(),
  hs_lastmodifieddate: z.string().nullish(),
});

const dealProperties = z.object({
  dealname: z.string().nullish(),
  dealstage: z.string().nullish(),
  pipeline: z.string().nullish(),
  amount: z.string().nullish(),
  closedate: z.string().nullish(),
  hubspot_owner_id: z.string().nullish(),
  createdate: z.string().nullish(),
  hs_lastmodifieddate: z.string().nullish(),
});

function crmRecordSchema(props: z.ZodType): z.ZodType {
  return z.object({
    id: idString,
    properties: props,
    createdAt: z.string(),
    updatedAt: z.string(),
    archived: z.boolean().optional(),
  });
}

const dealHistoryRecordSchema = z.object({
  id: idString,
  propertiesWithHistory: z
    .object({
      dealstage: z
        .array(
          z.object({
            value: z.string().nullish(),
            timestamp: z.string().nullish(),
            sourceType: z.string().nullish(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const campaignDetailSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().nullish(),
  subject: z.string().nullish(),
  fromName: z.string().nullish(),
  type: z.string().nullish(),
  lastProcessingFinishedAt: z.union([z.string(), z.number()]).nullish(),
  numIncluded: z.number().nullish(),
  counters: z
    .object({
      sent: z.number().optional(),
      delivered: z.number().optional(),
      open: z.number().optional(),
      click: z.number().optional(),
      bounce: z.number().optional(),
      unsubscribed: z.number().optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// HubSpotConnector
// ---------------------------------------------------------------------------

export class HubSpotConnector extends BaseConnector<
  HubSpotSettings,
  HubSpotCredentials
> {
  static readonly id = 'hubspot';

  static readonly schemas = {
    contacts: z.array(crmRecordSchema(contactProperties)),
    companies: z.array(crmRecordSchema(companyProperties)),
    deals: z.array(crmRecordSchema(dealProperties)),
    deal_events: z.array(dealHistoryRecordSchema),
    email_campaigns: z.array(campaignDetailSchema),
    email_stats: z.array(campaignDetailSchema),
  } as const;

  static create(input: unknown, ctx?: ConnectorContext): HubSpotConnector {
    const parsed = configFields.parse(input);
    return new HubSpotConnector(
      { resources: parsed.resources },
      { accessToken: parsed.accessToken },
      ctx,
    );
  }

  readonly id = 'hubspot';
  override readonly credentials = hubspotCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': connectorUserAgent('hubspot'),
    };
  }

  private apiGet<T>(
    url: string,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.get<T>(url, {
      resource,
      headers: this.buildHeaders(),
      signal,
    });
  }

  private apiPost<T>(
    url: string,
    resource: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.post<T>(url, {
      resource,
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal,
    });
  }

  // -------------------------------------------------------------------------
  // CRM search phases (contacts / companies / deals)
  // -------------------------------------------------------------------------

  private buildSearchBody(
    phase: CrmObjectPhase,
    after: string | null,
    options: SyncOptions,
  ): Record<string, unknown> {
    const modifiedProperty = MODIFIED_PROPERTY[phase];
    const filterGroups: unknown[] = [];
    if (options.since) {
      const sinceMs = new Date(options.since).getTime();
      if (Number.isFinite(sinceMs)) {
        filterGroups.push({
          filters: [
            {
              propertyName: modifiedProperty,
              operator: 'GTE',
              value: String(sinceMs),
            },
          ],
        });
      }
    }
    return {
      filterGroups,
      // Ascending modified-time keeps pagination stable while the `since`
      // filter trims the set upstream, so an incremental sync never scans
      // the whole object.
      sorts: [{ propertyName: modifiedProperty, direction: 'ASCENDING' }],
      properties: SEARCH_PROPERTIES[phase],
      limit: SEARCH_LIMIT,
      ...(after ? { after } : {}),
    };
  }

  private async fetchSearchPage(
    phase: CrmObjectPhase,
    after: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const body = this.buildSearchBody(phase, after, options);
    const res = await this.apiPost<CrmSearchResponse>(
      `${BASE_URL}/crm/v3/objects/${phase}/search`,
      phase,
      body,
      signal,
    );
    return {
      items: res.body.results,
      next: res.body.paging?.next?.after ?? null,
    };
  }

  private async writeSearchPhase(
    storage: StorageHandle,
    phase: CrmObjectPhase,
    items: CrmRecord[],
  ): Promise<void> {
    for (const record of items) {
      const props = record.properties;
      const modifiedProperty = MODIFIED_PROPERTY[phase];
      const updatedAt =
        parseEpoch(record.updatedAt, 'iso') ??
        parseEpoch(props[modifiedProperty], 'ms') ??
        0;

      let attributes: Record<string, string | number | null>;
      if (phase === 'contacts') {
        attributes = {
          email: props.email ?? null,
          lifecycleStage: props.lifecyclestage ?? null,
          leadStatus: props.hs_lead_status ?? null,
          ownerId: props.hubspot_owner_id ?? null,
          createdAt: parseEpoch(props.createdate, 'ms'),
        };
      } else if (phase === 'companies') {
        attributes = {
          name: props.name ?? null,
          domain: props.domain ?? null,
          industry: props.industry ?? null,
          lifecycleStage: props.lifecyclestage ?? null,
          createdAt: parseEpoch(props.createdate, 'ms'),
        };
      } else {
        attributes = {
          dealName: props.dealname ?? null,
          dealStage: props.dealstage ?? null,
          pipeline: props.pipeline ?? null,
          amount: finiteNumberOrNull(props.amount),
          closeDate: parseEpoch(props.closedate, 'ms'),
          ownerId: props.hubspot_owner_id ?? null,
          createdAt: parseEpoch(props.createdate, 'ms'),
        };
      }

      await storage.entity({
        type: ENTITY_TYPE_BY_PHASE[phase]!,
        id: record.id,
        attributes,
        updated_at: updatedAt,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Deal stage-change events (deal property history)
  // -------------------------------------------------------------------------

  private async fetchDealHistoryPage(
    after: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const url = new URL(`${BASE_URL}/crm/v3/objects/deals`);
    url.searchParams.set('limit', String(LIST_LIMIT));
    url.searchParams.set('properties', 'dealstage');
    url.searchParams.set('propertiesWithHistory', 'dealstage');
    if (after) {
      url.searchParams.set('after', after);
    }
    const res = await this.apiGet<CrmListResponse>(
      url.toString(),
      'deal_events',
      signal,
    );
    return {
      items: res.body.results,
      next: res.body.paging?.next?.after ?? null,
    };
  }

  private async writeDealEvents(
    storage: StorageHandle,
    items: DealHistoryRecord[],
    options: SyncOptions,
  ): Promise<void> {
    const sinceMs = options.since ? new Date(options.since).getTime() : null;
    const floor = sinceMs !== null && Number.isFinite(sinceMs) ? sinceMs : null;

    for (const record of items) {
      const history = record.propertiesWithHistory?.dealstage ?? [];
      for (const entry of history) {
        const ts = parseEpoch(entry.timestamp, 'iso');
        if (ts === null) {
          continue;
        }
        if (floor !== null && ts < floor) {
          continue;
        }
        await storage.event({
          name: DEAL_STAGE_EVENT,
          start_ts: ts,
          end_ts: null,
          attributes: {
            dealId: record.id,
            stage: entry.value ?? null,
            sourceType: entry.sourceType ?? null,
          },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Marketing email campaigns + stats (legacy email campaigns API)
  // -------------------------------------------------------------------------

  private async fetchCampaignDetail(
    id: number | string,
    resource: string,
    signal?: AbortSignal,
  ): Promise<CampaignDetail> {
    const res = await this.apiGet<CampaignDetail>(
      `${BASE_URL}/email/public/v1/campaigns/${id}`,
      resource,
      signal,
    );
    return res.body;
  }

  private async fetchCampaignsPage(
    phase: 'email_campaigns' | 'email_stats',
    after: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const url = new URL(`${BASE_URL}/email/public/v1/campaigns`);
    url.searchParams.set('limit', String(LIST_LIMIT));
    if (after) {
      url.searchParams.set('offset', after);
    }
    const listRes = await this.apiGet<CampaignListResponse>(
      url.toString(),
      `${phase}_list`,
      signal,
    );
    const { campaigns, hasMore, offset } = listRes.body;

    const details: CampaignDetail[] = [];
    for (const campaign of campaigns) {
      details.push(await this.fetchCampaignDetail(campaign.id, phase, signal));
    }

    const next =
      hasMore && offset !== undefined && offset !== null
        ? String(offset)
        : null;
    return { items: details, next };
  }

  private async writeEmailCampaigns(
    storage: StorageHandle,
    items: CampaignDetail[],
  ): Promise<void> {
    for (const detail of items) {
      const sentDate = parseEpoch(detail.lastProcessingFinishedAt, 'ms');
      await storage.entity({
        type: ENTITY_TYPE_BY_PHASE.email_campaigns!,
        id: String(detail.id),
        attributes: {
          name: detail.name ?? null,
          subject: detail.subject ?? null,
          fromName: detail.fromName ?? null,
          type: detail.type ?? null,
          sentDate,
          numIncluded: detail.numIncluded ?? null,
        },
        updated_at: sentDate ?? 0,
      });
    }
  }

  private async writeEmailStats(
    storage: StorageHandle,
    items: CampaignDetail[],
  ): Promise<void> {
    for (const detail of items) {
      const counters = detail.counters ?? {};
      const sent = counterValue(counters.sent);
      await storage.metric({
        name: EMAIL_STATS_METRIC,
        ts: parseEpoch(detail.lastProcessingFinishedAt, 'ms') ?? 0,
        value: sent,
        attributes: {
          campaignId: String(detail.id),
          campaignName: detail.name ?? null,
          sent,
          delivered: counterValue(counters.delivered),
          opened: counterValue(counters.open),
          clicked: counterValue(counters.click),
          bounced: counterValue(counters.bounce),
          unsubscribed: counterValue(counters.unsubscribed),
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Scope clearing (idempotency)
  // -------------------------------------------------------------------------

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: HubSpotPhase,
    isFull: boolean,
  ): Promise<void> {
    if (phase === 'deal_events') {
      // Events never upsert and the list endpoint has no `since` filter, so
      // every sync rewrites the requested window — clear in both modes.
      await storage.events([], { names: [DEAL_STAGE_EVENT] });
      return;
    }
    if (phase === 'email_stats') {
      await storage.metrics([], { names: [EMAIL_STATS_METRIC] });
      return;
    }
    // Entity phases upsert by id, so only a full backfill needs to drop stale
    // rows; incremental ticks just overwrite the records they touch.
    if (!isFull) {
      return;
    }
    const entityType = ENTITY_TYPE_BY_PHASE[phase];
    if (entityType) {
      await storage.entities([], { types: [entityType] });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: HubSpotPhase,
    items: unknown[],
    options: SyncOptions,
  ): Promise<void> {
    switch (phase) {
      case 'contacts':
      case 'companies':
      case 'deals':
        await this.writeSearchPhase(storage, phase, items as CrmRecord[]);
        return;
      case 'deal_events':
        await this.writeDealEvents(
          storage,
          items as DealHistoryRecord[],
          options,
        );
        return;
      case 'email_campaigns':
        await this.writeEmailCampaigns(storage, items as CampaignDetail[]);
        return;
      case 'email_stats':
        await this.writeEmailStats(storage, items as CampaignDetail[]);
        return;
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isHubSpotSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<HubSpotResource, HubSpotPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<HubSpotPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        if (
          phase === 'contacts' ||
          phase === 'companies' ||
          phase === 'deals'
        ) {
          return this.fetchSearchPage(phase, page, options, sig);
        }
        if (phase === 'deal_events') {
          return this.fetchDealHistoryPage(page, sig);
        }
        return this.fetchCampaignsPage(phase, page, sig);
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        await this.writePhase(storage, phase, items, options);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Aggregates — count via the CRM Search API `total` (one request)
  // -------------------------------------------------------------------------

  override async aggregate(
    req: AggregateRequest,
    signal?: AbortSignal,
  ): Promise<AggregateValue> {
    if (req.fn !== 'count') {
      throw unsupportedAggregate(req);
    }
    const object = COUNT_RESOURCE_TO_OBJECT[req.resource];
    if (!object) {
      throw unsupportedAggregate(req);
    }
    const filterGroups = this.translateCountFilter(req.filter);
    const res = await this.apiPost<CrmSearchResponse>(
      `${BASE_URL}/crm/v3/objects/${object}/search`,
      object,
      { filterGroups, properties: [], limit: 1 },
      signal,
    );
    const value = res.body.total ?? 0;
    this.logger.info('aggregate', {
      fn: 'count',
      resource: req.resource,
      filter: req.filter,
      value,
      via: 'CRM search API',
    });
    return value;
  }

  validateCountFilter(resource: string, filter: FilterClause[]): void {
    if (!COUNT_RESOURCE_TO_OBJECT[resource]) {
      throw new Error(
        `HubSpot aggregate count: unsupported resource=${resource}`,
      );
    }
    this.translateCountFilter(filter);
  }

  // Translates flat AND filter conditions into HubSpot search `filterGroups`.
  // OR clauses aren't expressible alongside the rest of the group model, so
  // they throw "unsupported" and the runner falls back to storage rows.
  private translateCountFilter(
    filter: FilterClause[] | undefined,
  ): Array<{ filters: unknown[] }> {
    if (!filter || filter.length === 0) {
      return [];
    }
    const filters = filter.map((clause) => {
      if ('or' in clause) {
        throw new Error(
          'HubSpot aggregate count: OR filter clauses are not supported',
        );
      }
      const operator = FILTER_OP_TO_HUBSPOT[clause.op];
      if (!operator) {
        throw new Error(
          `HubSpot aggregate count: unsupported filter operator ${clause.op}`,
        );
      }
      return {
        propertyName: clause.field,
        operator,
        value: String(clause.value),
      };
    });
    return [{ filters }];
  }
}
