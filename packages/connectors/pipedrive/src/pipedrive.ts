import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type FetchSpec,
  type FilterClause,
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
    companyDomain: z
      .string()
      .trim()
      .min(1)
      .regex(
        /^[a-z0-9][a-z0-9-]*$/i,
        'Use the company domain only (e.g. "acme" for acme.pipedrive.com), without the protocol or path.',
      )
      .meta({
        label: 'Company domain',
        description:
          'Your Pipedrive company domain, the "acme" in acme.pipedrive.com.',
        placeholder: 'acme',
      }),
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API token',
      description:
        'Pipedrive personal API token with read access. Find it under Settings -> Personal preferences -> API.',
      placeholder: 'a1b2c3d4...',
      secret: true,
    }),
    resources: z
      .array(z.enum(['deals', 'deal_events', 'pipelines', 'activities']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Pipedrive resources to sync. Omit to sync all of them. The API token only needs read access to the resources listed here.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Pipedrive',
  category: 'sales',
  brandColor: '#017737',
  tagline:
    'Sync deals, deal stage-change events, pipelines, and activities from Pipedrive for open-pipeline value, win rate, and deals-closed analytics.',
  vendor: {
    name: 'Pipedrive',
    domain: 'pipedrive.com',
    apiDocs: 'https://developers.pipedrive.com/docs/api/v1',
    website: 'https://www.pipedrive.com',
  },
  auth: {
    summary:
      'A Pipedrive personal API token with read access to the resources you sync (deals, pipelines, and activities). The token is passed as the `api_token` query parameter, per Pipedrive API-token authentication.',
    setup: [
      'In Pipedrive, open Settings -> Personal preferences -> API.',
      'Copy your personal API token (regenerate it there if you need a fresh one).',
      'Store it as a secret and reference it from the connector config as `apiToken: secret("PIPEDRIVE_API_TOKEN")`, alongside your company domain (the "acme" in acme.pipedrive.com).',
    ],
  },
  rateLimit:
    'Pipedrive applies a per-token budget (roughly the plan-based daily allowance plus a burst limit) and signals throttling via 429 with a Retry-After header; the shared HTTP client honors Retry-After on backoff.',
  limitations: [
    'Deal stage-change events are derived from each deal’s change history (GET /deals/{id}/flow), one request per deal, and the event scope is cleared and rewritten on every sync.',
    'Deals sync incrementally by `update_time`; pipelines and activities are re-listed in full on every sync.',
    'Custom deal and activity fields are not synced; only the standard fields listed below are stored.',
  ],
});

export interface PipedriveSettings {
  companyDomain: string;
  resources?: readonly PipedriveResource[];
}

const pipedriveCredentials = {
  apiToken: {
    description: 'Pipedrive personal API token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type PipedriveCredentials = typeof pipedriveCredentials;

const PHASE_ORDER = [
  'deals',
  'deal_events',
  'pipelines',
  'activities',
] as const;

type PipedrivePhase = (typeof PHASE_ORDER)[number];

export type PipedriveResource = PipedrivePhase;

const isPipedriveSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const PAGE_SIZE = 100;

const DEAL_ENTITY = 'pipedrive_deal';
const DEAL_STAGE_EVENT = 'pipedrive_deal_stage_change';
const PIPELINE_ENTITY = 'pipedrive_pipeline';
const ACTIVITY_ENTITY = 'pipedrive_activity';

const refSchema = z
  .union([
    z.number(),
    z.string(),
    z.object({
      value: z.number().nullish(),
      id: z.number().nullish(),
      name: z.string().nullish(),
    }),
  ])
  .nullish();

const dealSchema = z.object({
  id: z.number(),
  title: z.string().nullish(),
  status: z.string().nullish(),
  value: z.union([z.number(), z.string()]).nullish(),
  currency: z.string().nullish(),
  stage_id: z.number().nullish(),
  pipeline_id: z.number().nullish(),
  user_id: refSchema,
  person_id: refSchema,
  org_id: refSchema,
  probability: z.number().nullish(),
  lost_reason: z.string().nullish(),
  active: z.boolean().nullish(),
  add_time: z.string().nullish(),
  update_time: z.string().nullish(),
  close_time: z.string().nullish(),
  won_time: z.string().nullish(),
  lost_time: z.string().nullish(),
  expected_close_date: z.string().nullish(),
});

const dealFlowEntrySchema = z.object({
  object: z.string().nullish(),
  timestamp: z.string().nullish(),
  data: z
    .object({
      id: z.number().nullish(),
      item_id: z.number().nullish(),
      user_id: z.number().nullish(),
      field_key: z.string().nullish(),
      old_value: z.union([z.number(), z.string()]).nullish(),
      new_value: z.union([z.number(), z.string()]).nullish(),
      log_time: z.string().nullish(),
    })
    .nullish(),
});

const pipelineSchema = z.object({
  id: z.number(),
  name: z.string().nullish(),
  active: z.boolean().nullish(),
  deal_probability: z.boolean().nullish(),
  order_nr: z.number().nullish(),
  add_time: z.string().nullish(),
  update_time: z.string().nullish(),
});

const activitySchema = z.object({
  id: z.number(),
  type: z.string().nullish(),
  subject: z.string().nullish(),
  done: z.boolean().nullish(),
  deal_id: z.number().nullish(),
  person_id: refSchema,
  org_id: refSchema,
  user_id: refSchema,
  due_date: z.string().nullish(),
  due_time: z.string().nullish(),
  marked_as_done_time: z.string().nullish(),
  add_time: z.string().nullish(),
  update_time: z.string().nullish(),
});

export const pipedriveResources = defineResources({
  [DEAL_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: ['open', 'won', 'lost', 'deleted'],
      },
      { field: 'stageId', ops: ['eq'] },
      { field: 'pipelineId', ops: ['eq'] },
    ],
    description:
      'Deals with title, status, value, stage, pipeline, owner, and lifecycle timestamps.',
    endpoint: 'GET /api/v1/deals',
    fields: [
      { name: 'title', description: 'Deal title.' },
      {
        name: 'status',
        description: 'Deal status (open, won, lost, deleted).',
      },
      { name: 'value', description: 'Deal monetary value.' },
      { name: 'currency', description: 'Currency code for the deal value.' },
      { name: 'stageId', description: 'Current pipeline stage id.' },
      { name: 'pipelineId', description: 'Pipeline the deal belongs to.' },
      { name: 'ownerId', description: 'Owning user id.' },
      { name: 'personId', description: 'Linked person id (null if none).' },
      {
        name: 'orgId',
        description: 'Linked organization id (null if none).',
      },
      {
        name: 'probability',
        description: 'Win probability percentage (null if unset).',
      },
      { name: 'active', description: 'Whether the deal is active.' },
      {
        name: 'closeTime',
        description: 'When the deal was closed (Unix ms, null if open).',
      },
      {
        name: 'wonTime',
        description: 'When the deal was marked won (Unix ms, null otherwise).',
      },
      {
        name: 'lostTime',
        description: 'When the deal was marked lost (Unix ms, null otherwise).',
      },
      {
        name: 'lostReason',
        description: 'Free-text reason the deal was lost (null if not lost).',
      },
      {
        name: 'expectedCloseDate',
        description: 'Expected close date (Unix ms, null if unset).',
      },
      {
        name: 'createdAt',
        description: 'When the deal was created (Unix ms).',
      },
    ],
    responses: { deals: z.array(dealSchema) },
  },
  [DEAL_STAGE_EVENT]: {
    shape: 'event',
    filterable: [],
    description:
      'Deal stage-change events derived from each deal’s change history, one event per stage transition.',
    endpoint: 'GET /api/v1/deals/{id}/flow',
    notes:
      'Derived from each deal’s flow; the scope is cleared and rewritten on every sync.',
    fields: [
      { name: 'dealId', description: 'The deal the transition belongs to.' },
      {
        name: 'fromStageId',
        description: 'Stage id the deal moved from (null if unknown).',
      },
      { name: 'toStageId', description: 'Stage id the deal moved to.' },
      {
        name: 'userId',
        description: 'User who made the change (null if unknown).',
      },
    ],
    responses: { deal_flow: z.array(dealFlowEntrySchema) },
  },
  [PIPELINE_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description: 'Sales pipelines used to group deal stages.',
    endpoint: 'GET /api/v1/pipelines',
    fields: [
      { name: 'name', description: 'Pipeline name.' },
      { name: 'active', description: 'Whether the pipeline is active.' },
      {
        name: 'dealProbability',
        description: 'Whether deal probability is enabled for this pipeline.',
      },
      {
        name: 'orderNr',
        description: 'Display order of the pipeline.',
      },
      {
        name: 'createdAt',
        description: 'When the pipeline was created (Unix ms).',
      },
    ],
    responses: { pipelines: z.array(pipelineSchema) },
  },
  [ACTIVITY_ENTITY]: {
    shape: 'entity',
    filterable: [{ field: 'type', ops: ['eq'] }],
    description:
      'Activities (calls, meetings, tasks, emails) linked to deals, people, and organizations.',
    endpoint: 'GET /api/v1/activities',
    fields: [
      { name: 'type', description: 'Activity type key (call, meeting, etc.).' },
      { name: 'subject', description: 'Activity subject line.' },
      { name: 'done', description: 'Whether the activity is completed.' },
      {
        name: 'dealId',
        description: 'Linked deal id (null if none).',
      },
      { name: 'personId', description: 'Linked person id (null if none).' },
      {
        name: 'orgId',
        description: 'Linked organization id (null if none).',
      },
      { name: 'userId', description: 'Assigned user id.' },
      {
        name: 'dueDate',
        description: 'Due date (Unix ms at UTC midnight, null if unset).',
      },
      {
        name: 'doneTime',
        description:
          'When the activity was marked done (Unix ms, null if not).',
      },
      {
        name: 'createdAt',
        description: 'When the activity was created (Unix ms).',
      },
    ],
    responses: { activities: z.array(activitySchema) },
  },
});

export const id = 'pipedrive';

interface DealRecord {
  id: number;
  title?: string | null;
  status?: string | null;
  value?: number | string | null;
  currency?: string | null;
  stage_id?: number | null;
  pipeline_id?: number | null;
  user_id?: RefValue;
  person_id?: RefValue;
  org_id?: RefValue;
  probability?: number | null;
  lost_reason?: string | null;
  active?: boolean | null;
  add_time?: string | null;
  update_time?: string | null;
  close_time?: string | null;
  won_time?: string | null;
  lost_time?: string | null;
  expected_close_date?: string | null;
}

interface DealFlowEntry {
  object?: string | null;
  timestamp?: string | null;
  data?: {
    id?: number | null;
    item_id?: number | null;
    user_id?: number | null;
    field_key?: string | null;
    old_value?: number | string | null;
    new_value?: number | string | null;
    log_time?: string | null;
  } | null;
}

interface PipelineRecord {
  id: number;
  name?: string | null;
  active?: boolean | null;
  deal_probability?: boolean | null;
  order_nr?: number | null;
  add_time?: string | null;
  update_time?: string | null;
}

interface ActivityRecord {
  id: number;
  type?: string | null;
  subject?: string | null;
  done?: boolean | null;
  deal_id?: number | null;
  person_id?: RefValue;
  org_id?: RefValue;
  user_id?: RefValue;
  due_date?: string | null;
  due_time?: string | null;
  marked_as_done_time?: string | null;
  add_time?: string | null;
  update_time?: string | null;
}

type RefValue =
  | number
  | string
  | { value?: number | null; id?: number | null; name?: string | null }
  | null
  | undefined;

interface Pagination {
  start?: number | null;
  limit?: number | null;
  more_items_in_collection?: boolean | null;
  next_start?: number | null;
}

interface ListResponse<T> {
  data?: T[] | null;
  additional_data?: { pagination?: Pagination | null } | null;
}

interface StageChange {
  dealId: string;
  fromStageId: string | null;
  toStageId: string | null;
  userId: string | null;
  ts: number;
}

function refId(value: RefValue): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return value === '' ? null : value;
  }
  const inner = value.value ?? value.id;
  return typeof inner === 'number' ? String(inner) : null;
}

function numberOrNull(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function pdTimeToMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (trimmed.includes(' ')) {
    return parseEpoch(`${trimmed.replace(' ', 'T')}Z`, 'iso');
  }
  return parseEpoch(trimmed, 'iso');
}

function nextStartCursor(res: ListResponse<unknown>): string | null {
  const pagination = res.additional_data?.pagination;
  if (
    pagination?.more_items_in_collection &&
    pagination.next_start !== null &&
    pagination.next_start !== undefined
  ) {
    return String(pagination.next_start);
  }
  return null;
}

function pushableEq(
  filter: FilterClause[] | undefined,
  field: string,
): string | null {
  if (!filter) {
    return null;
  }
  for (const clause of filter) {
    if (
      'field' in clause &&
      clause.field === field &&
      clause.op === 'eq' &&
      typeof clause.value === 'string'
    ) {
      return clause.value;
    }
  }
  return null;
}

const ENTITY_TYPE_BY_PHASE: Partial<Record<PipedrivePhase, string>> = {
  deals: DEAL_ENTITY,
  pipelines: PIPELINE_ENTITY,
  activities: ACTIVITY_ENTITY,
};

export class PipedriveConnector extends BaseConnector<
  PipedriveSettings,
  PipedriveCredentials
> {
  static readonly id = id;

  static readonly resources = pipedriveResources;

  static readonly schemas = schemasFromResources(pipedriveResources);

  static create(input: unknown, ctx?: ConnectorContext): PipedriveConnector {
    const parsed = configFields.parse(input);
    return new PipedriveConnector(
      { companyDomain: parsed.companyDomain, resources: parsed.resources },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = pipedriveCredentials;

  private get baseUrl(): string {
    return `https://${this.settings.companyDomain}.pipedrive.com/api/v1`;
  }

  private buildUrl(path: string, params: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('api_token', this.creds.apiToken);
    return url.toString();
  }

  private buildHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('pipedrive'),
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

  private singleSpec(
    options: SyncOptions,
    resource: string,
  ): FetchSpec | undefined {
    const specs = options.fetchSpecs?.[resource];
    return specs && specs.length === 1 ? specs[0] : undefined;
  }

  private buildDealsUrl(
    page: string | null,
    options: SyncOptions,
    forEvents: boolean,
  ): string {
    const params: Record<string, string> = {
      start: page ?? '0',
      limit: String(PAGE_SIZE),
      sort: 'update_time DESC',
    };
    const filter = forEvents
      ? undefined
      : this.singleSpec(options, DEAL_ENTITY)?.filter;
    const status = pushableEq(filter, 'status');
    params.status = status ?? 'all_not_deleted';
    const stageId = pushableEq(filter, 'stageId');
    if (stageId !== null) {
      params.stage_id = stageId;
    }
    const pipelineId = pushableEq(filter, 'pipelineId');
    if (pipelineId !== null) {
      params.pipeline_id = pipelineId;
    }
    return this.buildUrl('/deals', params);
  }

  private async fetchDeals(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const res = await this.apiGet<ListResponse<DealRecord>>(
      this.buildDealsUrl(page, options, false),
      'deals',
      signal,
    );
    const data = res.body.data ?? [];
    const sinceMs = options.since ? new Date(options.since).getTime() : null;
    if (sinceMs === null || !Number.isFinite(sinceMs)) {
      return { items: data, next: nextStartCursor(res.body) };
    }
    const kept: DealRecord[] = [];
    let sawOlder = false;
    for (const deal of data) {
      const updateMs = pdTimeToMs(deal.update_time);
      if (updateMs !== null && updateMs < sinceMs) {
        sawOlder = true;
        continue;
      }
      kept.push(deal);
    }
    return {
      items: kept,
      next: sawOlder ? null : nextStartCursor(res.body),
    };
  }

  private async writeDeals(
    storage: StorageHandle,
    items: DealRecord[],
  ): Promise<void> {
    for (const deal of items) {
      const attributes: Record<string, JSONValue> = {
        title: deal.title ?? null,
        status: deal.status ?? null,
        value: numberOrNull(deal.value),
        currency: deal.currency ?? null,
        stageId:
          deal.stage_id !== null && deal.stage_id !== undefined
            ? String(deal.stage_id)
            : null,
        pipelineId:
          deal.pipeline_id !== null && deal.pipeline_id !== undefined
            ? String(deal.pipeline_id)
            : null,
        ownerId: refId(deal.user_id),
        personId: refId(deal.person_id),
        orgId: refId(deal.org_id),
        probability: deal.probability ?? null,
        active: deal.active ?? null,
        closeTime: pdTimeToMs(deal.close_time),
        wonTime: pdTimeToMs(deal.won_time),
        lostTime: pdTimeToMs(deal.lost_time),
        lostReason: deal.lost_reason ?? null,
        expectedCloseDate: pdTimeToMs(deal.expected_close_date),
        createdAt: pdTimeToMs(deal.add_time),
      };
      await storage.entity({
        type: DEAL_ENTITY,
        id: String(deal.id),
        attributes,
        updated_at:
          pdTimeToMs(deal.update_time) ?? pdTimeToMs(deal.add_time) ?? 0,
      });
    }
  }

  private async fetchDealFlow(
    dealId: number,
    signal?: AbortSignal,
  ): Promise<StageChange[]> {
    const changes: StageChange[] = [];
    let start: string | null = '0';
    while (start !== null) {
      const res = await this.apiGet<ListResponse<DealFlowEntry>>(
        this.buildUrl(`/deals/${dealId}/flow`, {
          start,
          limit: String(PAGE_SIZE),
        }),
        'deal_events',
        signal,
      );
      for (const entry of res.body.data ?? []) {
        if (entry.object !== 'dealChange') {
          continue;
        }
        const data = entry.data;
        if (!data || data.field_key !== 'stage_id') {
          continue;
        }
        const ts = pdTimeToMs(data.log_time ?? entry.timestamp);
        if (ts === null) {
          continue;
        }
        changes.push({
          dealId: refId(data.item_id) ?? String(dealId),
          fromStageId: refId(data.old_value ?? null),
          toStageId: refId(data.new_value ?? null),
          userId: refId(data.user_id ?? null),
          ts,
        });
      }
      start = nextStartCursor(res.body);
    }
    return changes;
  }

  private async fetchDealEvents(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const res = await this.apiGet<ListResponse<DealRecord>>(
      this.buildDealsUrl(page, options, true),
      'deal_events',
      signal,
    );
    const changes: StageChange[] = [];
    for (const deal of res.body.data ?? []) {
      changes.push(...(await this.fetchDealFlow(deal.id, signal)));
    }
    return { items: changes, next: nextStartCursor(res.body) };
  }

  private async writeDealEvents(
    storage: StorageHandle,
    items: StageChange[],
  ): Promise<void> {
    for (const change of items) {
      await storage.event({
        name: DEAL_STAGE_EVENT,
        start_ts: change.ts,
        end_ts: null,
        attributes: {
          dealId: change.dealId,
          fromStageId: change.fromStageId,
          toStageId: change.toStageId,
          userId: change.userId,
        },
      });
    }
  }

  private async fetchPipelines(
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const res = await this.apiGet<ListResponse<PipelineRecord>>(
      this.buildUrl('/pipelines', {}),
      'pipelines',
      signal,
    );
    return { items: res.body.data ?? [], next: null };
  }

  private async writePipelines(
    storage: StorageHandle,
    items: PipelineRecord[],
  ): Promise<void> {
    for (const pipeline of items) {
      await storage.entity({
        type: PIPELINE_ENTITY,
        id: String(pipeline.id),
        attributes: {
          name: pipeline.name ?? null,
          active: pipeline.active ?? null,
          dealProbability: pipeline.deal_probability ?? null,
          orderNr: pipeline.order_nr ?? null,
          createdAt: pdTimeToMs(pipeline.add_time),
        },
        updated_at:
          pdTimeToMs(pipeline.update_time) ??
          pdTimeToMs(pipeline.add_time) ??
          0,
      });
    }
  }

  private buildActivitiesUrl(
    page: string | null,
    options: SyncOptions,
  ): string {
    const params: Record<string, string> = {
      start: page ?? '0',
      limit: String(PAGE_SIZE),
      user_id: '0',
    };
    const type = pushableEq(
      this.singleSpec(options, ACTIVITY_ENTITY)?.filter,
      'type',
    );
    if (type !== null) {
      params.type = type;
    }
    return this.buildUrl('/activities', params);
  }

  private async fetchActivities(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const res = await this.apiGet<ListResponse<ActivityRecord>>(
      this.buildActivitiesUrl(page, options),
      'activities',
      signal,
    );
    return { items: res.body.data ?? [], next: nextStartCursor(res.body) };
  }

  private async writeActivities(
    storage: StorageHandle,
    items: ActivityRecord[],
  ): Promise<void> {
    for (const activity of items) {
      await storage.entity({
        type: ACTIVITY_ENTITY,
        id: String(activity.id),
        attributes: {
          type: activity.type ?? null,
          subject: activity.subject ?? null,
          done: activity.done ?? null,
          dealId:
            activity.deal_id !== null && activity.deal_id !== undefined
              ? String(activity.deal_id)
              : null,
          personId: refId(activity.person_id),
          orgId: refId(activity.org_id),
          userId: refId(activity.user_id),
          dueDate: pdTimeToMs(activity.due_date),
          doneTime: pdTimeToMs(activity.marked_as_done_time),
          createdAt: pdTimeToMs(activity.add_time),
        },
        updated_at:
          pdTimeToMs(activity.update_time) ??
          pdTimeToMs(activity.add_time) ??
          0,
      });
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: PipedrivePhase,
    isFull: boolean,
  ): Promise<void> {
    if (phase === 'deal_events') {
      await storage.events([], { names: [DEAL_STAGE_EVENT] });
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

  private async writePhase(
    storage: StorageHandle,
    phase: PipedrivePhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'deals':
        await this.writeDeals(storage, items as DealRecord[]);
        return;
      case 'deal_events':
        await this.writeDealEvents(storage, items as StageChange[]);
        return;
      case 'pipelines':
        await this.writePipelines(storage, items as PipelineRecord[]);
        return;
      case 'activities':
        await this.writeActivities(storage, items as ActivityRecord[]);
        return;
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isPipedriveSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<PipedriveResource, PipedrivePhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<PipedrivePhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'deals':
            return this.fetchDeals(page, options, sig);
          case 'deal_events':
            return this.fetchDealEvents(page, options, sig);
          case 'pipelines':
            return this.fetchPipelines(sig);
          case 'activities':
            return this.fetchActivities(page, options, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}
