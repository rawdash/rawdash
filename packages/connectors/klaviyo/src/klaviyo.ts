import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
  sanitizeAllowedUrl,
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
    apiKey: z.object({ $secret: z.string() }).meta({
      label: 'Private API Key',
      description:
        'Klaviyo Private API Key with read scopes for campaigns, flows, lists, and segments. Create one at Klaviyo -> Settings -> API Keys.',
      placeholder: 'pk_...',
      secret: true,
    }),
    apiRevision: z
      .string()
      .trim()
      .regex(
        /^\d{4}-\d{2}-\d{2}(\.pre)?$/,
        'Use a Klaviyo API revision date like "2024-10-15".',
      )
      .default('2024-10-15')
      .meta({
        label: 'API revision',
        description:
          'Value sent in the revision header. Defaults to 2024-10-15; pin a specific date here when upgrading deliberately.',
        placeholder: '2024-10-15',
      }),
    channel: z.enum(['email', 'sms', 'mobile_push']).default('email').meta({
      label: 'Campaign channel',
      description:
        "Which campaign channel to sync. The Klaviyo campaigns endpoint requires a channel filter and only returns one channel per call; defaults to 'email'.",
      placeholder: 'email',
    }),
    resources: z
      .array(z.enum(['lists', 'segments', 'campaigns', 'flows']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Klaviyo resources to sync. Omit to sync all of them. The key only needs read scopes for the resources listed here.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Klaviyo',
  category: 'marketing',
  brandColor: '#000000',
  tagline:
    'Sync campaigns, flows, lists, and segments from Klaviyo for ecommerce email and SMS marketing analytics.',
  vendor: {
    name: 'Klaviyo',
    domain: 'klaviyo.com',
    apiDocs: 'https://developers.klaviyo.com/en/reference/api_overview',
    website: 'https://www.klaviyo.com',
  },
  auth: {
    summary:
      'A Klaviyo Private API Key with read access to campaigns, flows, lists, and segments.',
    setup: [
      'Open Klaviyo -> Settings -> API Keys and create a new Private API Key.',
      'Grant read access to Campaigns, Flows, Lists, and Segments (or only the scopes you intend to sync).',
      'Copy the generated key and store it as a secret, referencing it from the connector config as `apiKey: secret("KLAVIYO_API_KEY")`.',
    ],
  },
  rateLimit:
    'Klaviyo enforces per-endpoint burst and steady rate limits and signals them via the RateLimit-Remaining and RateLimit-Reset response headers. The shared HTTP client backs off on 429 and honors Retry-After.',
  limitations: [
    'Campaign and flow statistics (campaign-values-reports / flow-values-reports) are not synced; the reports endpoints require a per-account conversion metric id and are deferred to a follow-up.',
    'Profile, event, catalog, and coupon objects are out of scope (niche for dashboard use).',
    'Only one campaign channel per sync (email, sms, or mobile_push) - the Klaviyo campaigns endpoint requires the filter and does not allow OR across channels.',
  ],
});

export type KlaviyoChannel = 'email' | 'sms' | 'mobile_push';

export interface KlaviyoSettings {
  apiRevision: string;
  channel: KlaviyoChannel;
  resources?: readonly KlaviyoResource[];
}

const klaviyoCredentials = {
  apiKey: {
    description: 'Klaviyo Private API Key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type KlaviyoCredentials = typeof klaviyoCredentials;

const PHASE_ORDER = ['lists', 'segments', 'campaigns', 'flows'] as const;

type KlaviyoPhase = (typeof PHASE_ORDER)[number];

export type KlaviyoResource = KlaviyoPhase;

type KlaviyoSyncCursor = ChunkedSyncCursor<KlaviyoPhase, string>;

const isKlaviyoSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const KLAVIYO_API_HOST = 'a.klaviyo.com';
const KLAVIYO_API_BASE = `https://${KLAVIYO_API_HOST}/api`;
const PAGE_SIZE = 100;

const LIST_ENTITY = 'klaviyo_list';
const SEGMENT_ENTITY = 'klaviyo_segment';
const CAMPAIGN_ENTITY = 'klaviyo_campaign';
const FLOW_ENTITY = 'klaviyo_flow';

const ENTITY_TYPE_BY_PHASE: Record<KlaviyoPhase, string> = {
  lists: LIST_ENTITY,
  segments: SEGMENT_ENTITY,
  campaigns: CAMPAIGN_ENTITY,
  flows: FLOW_ENTITY,
};

const UPDATED_FIELD_BY_PHASE: Record<KlaviyoPhase, string> = {
  lists: 'updated',
  segments: 'updated',
  campaigns: 'updated_at',
  flows: 'updated',
};

interface JsonApiResource<TAttrs> {
  type: string;
  id: string;
  attributes: TAttrs;
}

interface JsonApiList<TAttrs> {
  data: Array<JsonApiResource<TAttrs>>;
  links?: { next?: string | null } | null;
}

interface ListAttributes {
  name?: string | null;
  created?: string | null;
  updated?: string | null;
  opt_in_process?: string | null;
}

interface SegmentAttributes {
  name?: string | null;
  created?: string | null;
  updated?: string | null;
  is_active?: boolean | null;
  is_starred?: boolean | null;
  is_processing?: boolean | null;
}

interface CampaignAttributes {
  name?: string | null;
  status?: string | null;
  archived?: boolean | null;
  channel?: string | null;
  send_time?: string | null;
  scheduled_at?: string | null;
  send_strategy?: { method?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface FlowAttributes {
  name?: string | null;
  status?: string | null;
  archived?: boolean | null;
  trigger_type?: string | null;
  created?: string | null;
  updated?: string | null;
}

const idString = z.string().min(1);

function jsonApiList<T extends z.ZodTypeAny>(attributes: T) {
  return z.object({
    data: z.array(
      z.object({
        type: z.string(),
        id: idString,
        attributes,
      }),
    ),
    links: z.object({ next: z.string().nullish() }).nullish(),
  });
}

const listsResponseSchema = jsonApiList(
  z.object({
    name: z.string().nullish(),
    created: z.string().nullish(),
    updated: z.string().nullish(),
    opt_in_process: z.string().nullish(),
  }),
);

const segmentsResponseSchema = jsonApiList(
  z.object({
    name: z.string().nullish(),
    created: z.string().nullish(),
    updated: z.string().nullish(),
    is_active: z.boolean().nullish(),
    is_starred: z.boolean().nullish(),
    is_processing: z.boolean().nullish(),
  }),
);

const campaignsResponseSchema = jsonApiList(
  z.object({
    name: z.string().nullish(),
    status: z.string().nullish(),
    archived: z.boolean().nullish(),
    channel: z.string().nullish(),
    send_time: z.string().nullish(),
    scheduled_at: z.string().nullish(),
    send_strategy: z.object({ method: z.string().nullish() }).nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
  }),
);

const flowsResponseSchema = jsonApiList(
  z.object({
    name: z.string().nullish(),
    status: z.string().nullish(),
    archived: z.boolean().nullish(),
    trigger_type: z.string().nullish(),
    created: z.string().nullish(),
    updated: z.string().nullish(),
  }),
);

export const klaviyoResources = defineResources({
  [LIST_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Klaviyo lists (manually managed subscriber collections) with opt-in process and created/updated timestamps.',
    endpoint: 'GET /api/lists',
    fields: [
      { name: 'name', description: 'List display name.' },
      {
        name: 'optInProcess',
        description: 'Opt-in process (e.g. single_opt_in, double_opt_in).',
      },
      {
        name: 'createdAt',
        description: 'When the list was created (Unix ms).',
      },
    ],
    responses: { lists: listsResponseSchema },
  },
  [SEGMENT_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Klaviyo segments (rule-based dynamic groups) with active, starred, and processing flags.',
    endpoint: 'GET /api/segments',
    fields: [
      { name: 'name', description: 'Segment display name.' },
      { name: 'isActive', description: 'Whether the segment is active.' },
      { name: 'isStarred', description: 'Whether the segment is starred.' },
      {
        name: 'isProcessing',
        description: 'Whether the segment is currently recomputing.',
      },
      {
        name: 'createdAt',
        description: 'When the segment was created (Unix ms).',
      },
    ],
    responses: { segments: segmentsResponseSchema },
  },
  [CAMPAIGN_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Klaviyo campaigns for the configured channel, with status, archived flag, send strategy, and send time.',
    endpoint: 'GET /api/campaigns',
    notes:
      'Klaviyo requires a channel filter on /campaigns; this connector syncs one channel per instance (the configured `channel` setting).',
    fields: [
      { name: 'name', description: 'Campaign name.' },
      { name: 'status', description: 'Campaign status (Draft, Sent, etc.).' },
      { name: 'archived', description: 'Whether the campaign is archived.' },
      {
        name: 'channel',
        description: 'Campaign channel (email, sms, mobile_push).',
      },
      {
        name: 'sendStrategy',
        description: 'Send strategy method (static, smart_send_time, etc.).',
      },
      {
        name: 'sendTime',
        description: 'Scheduled or actual send time (Unix ms).',
      },
      {
        name: 'createdAt',
        description: 'When the campaign was created (Unix ms).',
      },
    ],
    responses: { campaigns: campaignsResponseSchema },
  },
  [FLOW_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Klaviyo flows (automation series) with status, trigger type, and archived flag.',
    endpoint: 'GET /api/flows',
    fields: [
      { name: 'name', description: 'Flow name.' },
      { name: 'status', description: 'Flow status (live, draft, manual).' },
      { name: 'archived', description: 'Whether the flow is archived.' },
      {
        name: 'triggerType',
        description: 'Flow trigger type (e.g. list, segment, metric).',
      },
      {
        name: 'createdAt',
        description: 'When the flow was created (Unix ms).',
      },
    ],
    responses: { flows: flowsResponseSchema },
  },
});

export const id = 'klaviyo';

export class KlaviyoConnector extends BaseConnector<
  KlaviyoSettings,
  KlaviyoCredentials
> {
  static readonly id = id;

  static readonly resources = klaviyoResources;

  static readonly schemas = schemasFromResources(klaviyoResources);

  static create(input: unknown, ctx?: ConnectorContext): KlaviyoConnector {
    const parsed = configFields.parse(input);
    return new KlaviyoConnector(
      {
        apiRevision: parsed.apiRevision,
        channel: parsed.channel,
        resources: parsed.resources,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = klaviyoCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Klaviyo-API-Key ${this.creds.apiKey}`,
      revision: this.settings.apiRevision,
      Accept: 'application/vnd.api+json',
      'User-Agent': connectorUserAgent('klaviyo'),
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

  private allowedPagePath(phase: KlaviyoPhase): string {
    switch (phase) {
      case 'lists':
        return '/api/lists';
      case 'segments':
        return '/api/segments';
      case 'campaigns':
        return '/api/campaigns';
      case 'flows':
        return '/api/flows';
    }
  }

  private sanitizePageUrl(
    phase: KlaviyoPhase,
    pageUrl: string | null,
  ): string | null {
    return sanitizeAllowedUrl({
      url: pageUrl,
      host: KLAVIYO_API_HOST,
      pathname: this.allowedPagePath(phase),
    });
  }

  private resolveCursor(cursor: unknown): KlaviyoSyncCursor | undefined {
    if (!isKlaviyoSyncCursor(cursor)) {
      return undefined;
    }
    return {
      phase: cursor.phase,
      page: this.sanitizePageUrl(cursor.phase, cursor.page),
    };
  }

  private buildInitialUrl(phase: KlaviyoPhase, options: SyncOptions): string {
    const u = new URL(`${KLAVIYO_API_BASE}${this.allowedPagePath(phase)}`);
    u.searchParams.set('page[size]', String(PAGE_SIZE));
    u.searchParams.set('sort', UPDATED_FIELD_BY_PHASE[phase]);
    const filters: string[] = [];
    if (phase === 'campaigns') {
      filters.push(`equals(messages.channel,'${this.settings.channel}')`);
    }
    if (options.since) {
      const date = new Date(options.since);
      if (Number.isFinite(date.getTime())) {
        filters.push(
          `greater-than(${UPDATED_FIELD_BY_PHASE[phase]},${date.toISOString()})`,
        );
      }
    }
    if (filters.length > 0) {
      u.searchParams.set('filter', filters.join(','));
    }
    return u.toString();
  }

  private async fetchPhasePage<TAttrs>(
    phase: KlaviyoPhase,
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{
    items: Array<JsonApiResource<TAttrs>>;
    next: string | null;
  }> {
    const url = page ?? this.buildInitialUrl(phase, options);
    const res = await this.apiGet<JsonApiList<TAttrs>>(url, phase, signal);
    const nextRaw = res.body.links?.next ?? null;
    const next = nextRaw ? this.sanitizePageUrl(phase, nextRaw) : null;
    return { items: res.body.data ?? [], next };
  }

  private async writeLists(
    storage: StorageHandle,
    items: Array<JsonApiResource<ListAttributes>>,
  ): Promise<void> {
    for (const item of items) {
      const attrs = item.attributes ?? ({} as ListAttributes);
      const createdMs = parseEpoch(attrs.created ?? null, 'iso');
      const updatedMs = parseEpoch(attrs.updated ?? null, 'iso');
      await storage.entity({
        type: LIST_ENTITY,
        id: item.id,
        attributes: {
          name: attrs.name ?? null,
          optInProcess: attrs.opt_in_process ?? null,
          createdAt: createdMs,
        },
        updated_at: updatedMs ?? createdMs ?? 0,
      });
    }
  }

  private async writeSegments(
    storage: StorageHandle,
    items: Array<JsonApiResource<SegmentAttributes>>,
  ): Promise<void> {
    for (const item of items) {
      const attrs = item.attributes ?? ({} as SegmentAttributes);
      const createdMs = parseEpoch(attrs.created ?? null, 'iso');
      const updatedMs = parseEpoch(attrs.updated ?? null, 'iso');
      await storage.entity({
        type: SEGMENT_ENTITY,
        id: item.id,
        attributes: {
          name: attrs.name ?? null,
          isActive: attrs.is_active ?? null,
          isStarred: attrs.is_starred ?? null,
          isProcessing: attrs.is_processing ?? null,
          createdAt: createdMs,
        },
        updated_at: updatedMs ?? createdMs ?? 0,
      });
    }
  }

  private async writeCampaigns(
    storage: StorageHandle,
    items: Array<JsonApiResource<CampaignAttributes>>,
  ): Promise<void> {
    for (const item of items) {
      const attrs = item.attributes ?? ({} as CampaignAttributes);
      const createdMs = parseEpoch(attrs.created_at ?? null, 'iso');
      const updatedMs = parseEpoch(attrs.updated_at ?? null, 'iso');
      const sendTimeMs = parseEpoch(
        attrs.send_time ?? attrs.scheduled_at ?? null,
        'iso',
      );
      await storage.entity({
        type: CAMPAIGN_ENTITY,
        id: item.id,
        attributes: {
          name: attrs.name ?? null,
          status: attrs.status ?? null,
          archived: attrs.archived ?? null,
          channel: attrs.channel ?? this.settings.channel,
          sendStrategy: attrs.send_strategy?.method ?? null,
          sendTime: sendTimeMs,
          createdAt: createdMs,
        },
        updated_at: updatedMs ?? createdMs ?? 0,
      });
    }
  }

  private async writeFlows(
    storage: StorageHandle,
    items: Array<JsonApiResource<FlowAttributes>>,
  ): Promise<void> {
    for (const item of items) {
      const attrs = item.attributes ?? ({} as FlowAttributes);
      const createdMs = parseEpoch(attrs.created ?? null, 'iso');
      const updatedMs = parseEpoch(attrs.updated ?? null, 'iso');
      await storage.entity({
        type: FLOW_ENTITY,
        id: item.id,
        attributes: {
          name: attrs.name ?? null,
          status: attrs.status ?? null,
          archived: attrs.archived ?? null,
          triggerType: attrs.trigger_type ?? null,
          createdAt: createdMs,
        },
        updated_at: updatedMs ?? createdMs ?? 0,
      });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: KlaviyoPhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'lists':
        return this.writeLists(
          storage,
          items as Array<JsonApiResource<ListAttributes>>,
        );
      case 'segments':
        return this.writeSegments(
          storage,
          items as Array<JsonApiResource<SegmentAttributes>>,
        );
      case 'campaigns':
        return this.writeCampaigns(
          storage,
          items as Array<JsonApiResource<CampaignAttributes>>,
        );
      case 'flows':
        return this.writeFlows(
          storage,
          items as Array<JsonApiResource<FlowAttributes>>,
        );
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<KlaviyoResource, KlaviyoPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<KlaviyoPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) =>
        this.fetchPhasePage(phase, page, options, sig),
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          await storage.entities([], { types: [ENTITY_TYPE_BY_PHASE[phase]] });
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}
