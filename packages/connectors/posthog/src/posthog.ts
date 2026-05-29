import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
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

const funnelDefinition = z.object({
  name: z.string().min(1),
  steps: z.array(z.string().min(1)).min(2),
  windowDays: z.number().int().positive().optional(),
});

export const configFields = defineConfigFields(
  z.object({
    apiKey: z.object({ $secret: z.string() }).meta({
      label: 'Personal API key',
      description:
        'PostHog personal API key with read access to the project. Create one at PostHog → Settings → Personal API keys (starts with `phx_`).',
      placeholder: 'phx_...',
      secret: true,
    }),
    projectId: z
      .string()
      .trim()
      .regex(/^\d+$/, 'PostHog project ID must be digits only')
      .meta({
        label: 'Project ID',
        description:
          'Numeric ID of your PostHog project. Find it in PostHog → Settings → Project → Project ID.',
        placeholder: '12345',
      }),
    host: z
      .string()
      .trim()
      .regex(
        /^https?:\/\/[^\s/]+$/,
        'Use a base URL with protocol and no trailing slash, e.g. https://us.posthog.com',
      )
      .default('https://us.posthog.com')
      .meta({
        label: 'Host',
        description:
          'PostHog instance base URL. Use https://us.posthog.com or https://eu.posthog.com for PostHog Cloud, or your self-hosted origin. No trailing slash.',
        placeholder: 'https://us.posthog.com',
      }),
    events: z.array(z.string().min(1)).nonempty().optional().meta({
      label: 'Tracked events',
      description:
        'Event names to roll up in the `events_per_day` resource. Omit to roll up every event in the project.',
    }),
    funnels: z.array(funnelDefinition).nonempty().optional().meta({
      label: 'Funnels',
      description:
        'Funnel definitions to evaluate. Each funnel is { name, steps: [event, …], windowDays? }. Conversion is measured over the sync window.',
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many calendar days of history to roll up on a full sync. Defaults to 30.',
      placeholder: '30',
    }),
    resources: z
      .array(
        z.enum([
          'feature_flags',
          'events_per_day',
          'feature_flag_usage',
          'active_users',
          'funnels',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which PostHog resources to sync. Omit to sync all of them.',
      }),
  }),
);

// ---------------------------------------------------------------------------
// Settings / credentials
// ---------------------------------------------------------------------------

export interface PostHogFunnel {
  name: string;
  steps: readonly string[];
  windowDays?: number;
}

export interface PostHogSettings {
  projectId: string;
  host: string;
  events?: readonly string[];
  funnels?: readonly PostHogFunnel[];
  lookbackDays?: number;
  resources?: readonly PostHogResource[];
}

const posthogCredentials = {
  apiKey: {
    description: 'PostHog personal API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type PostHogCredentials = typeof posthogCredentials;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = [
  'feature_flags',
  'events_per_day',
  'feature_flag_usage',
  'active_users',
  'funnels',
] as const;

type PostHogPhase = (typeof PHASE_ORDER)[number];

export type PostHogResource = PostHogPhase;

const isPostHogSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const FLAGS_PAGE_SIZE = 100;
const QUERY_PAGE_SIZE = 10_000;
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_FUNNEL_WINDOW_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const FEATURE_FLAG_ENTITY = 'posthog_feature_flag';
const EVENTS_PER_DAY_METRIC = 'posthog_events_per_day';
const FLAG_USAGE_METRIC = 'posthog_feature_flag_usage';
const ACTIVE_USERS_METRIC = 'posthog_active_users';
const FUNNEL_METRIC = 'posthog_funnel';

// Series order requested in the active-users TrendsQuery; the response keeps
// this order so the index maps back to the active-user window.
const ACTIVE_USER_WINDOWS = ['dau', 'wau', 'mau'] as const;
const ACTIVE_USER_MATH = ['dau', 'weekly_active', 'monthly_active'] as const;

// ---------------------------------------------------------------------------
// PostHog API types
// ---------------------------------------------------------------------------

interface FeatureFlagRecord {
  id: number;
  key: string;
  name?: string | null;
  active: boolean;
  rollout_percentage?: number | null;
  created_at?: string | null;
  filters?: unknown;
}

interface FeatureFlagListResponse {
  count?: number;
  next?: string | null;
  results: FeatureFlagRecord[];
}

interface HogQLResponse {
  results: Array<Array<string | number | boolean | null>>;
}

interface TrendsResponse {
  results: Array<{
    data: number[];
    days: string[];
    label?: string | null;
  }>;
}

interface FunnelStepResult {
  count: number;
  name?: string | null;
  order?: number | null;
}

interface FunnelResponse {
  results: FunnelStepResult[];
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function finiteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// PostHog dates from HogQL come back as 'YYYY-MM-DD' (or full timestamps).
// Treat them as UTC midnight so re-syncing the same day is idempotent.
function dateStringToMs(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const isoLike = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00.000Z`
    : trimmed;
  return parseEpoch(isoLike, 'iso');
}

// Filters are an opaque, deeply-nested PostHog payload. Persist a JSON snapshot
// rather than the raw object so no `undefined` (or non-serializable value)
// leaks into entity attributes.
function stringifyFilters(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : json;
  } catch {
    return null;
  }
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

function safeOffset(page: string | null): number {
  if (page === null) {
    return 0;
  }
  const n = Number(page);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function quoteHogQLString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// ---------------------------------------------------------------------------
// Schemas — describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const featureFlagSchema = z.object({
  id: z.number(),
  key: z.string().min(1),
  name: z.string().nullish(),
  active: z.boolean(),
  rollout_percentage: z.number().nullish(),
  created_at: z.string().nullish(),
});

// HogQL grouped rollups return positional rows: [day, key, count, distinct].
const dailyCountRow = z.tuple([
  z.string(),
  z.string().nullable(),
  z.number(),
  z.number(),
]);

const hogqlSchema = z.object({ results: z.array(dailyCountRow) });

const trendsSchema = z.object({
  results: z.array(
    z.object({
      data: z.array(z.number()),
      days: z.array(z.string()),
      label: z.string().nullish(),
    }),
  ),
});

const funnelSchema = z.object({
  results: z.array(
    z.object({
      count: z.number(),
      name: z.string().nullish(),
      order: z.number().nullish(),
    }),
  ),
});

// ---------------------------------------------------------------------------
// PostHogConnector
// ---------------------------------------------------------------------------

export class PostHogConnector extends BaseConnector<
  PostHogSettings,
  PostHogCredentials
> {
  static readonly id = 'posthog';

  static readonly schemas = {
    feature_flags: z.array(featureFlagSchema),
    events_per_day: hogqlSchema,
    feature_flag_usage: hogqlSchema,
    active_users: trendsSchema,
    funnels: funnelSchema,
  } as const;

  static create(input: unknown, ctx?: ConnectorContext): PostHogConnector {
    const parsed = configFields.parse(input);
    return new PostHogConnector(
      {
        projectId: parsed.projectId,
        host: parsed.host,
        events: parsed.events,
        funnels: parsed.funnels,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = 'posthog';
  override readonly credentials = posthogCredentials;

  private get baseUrl(): string {
    return this.settings.host.replace(/\/+$/, '');
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': connectorUserAgent('posthog'),
    };
  }

  // ISO date (YYYY-MM-DD) that bounds the rollup window. Metric phases use
  // clear-and-rewrite, so the window must always cover the full lookback or
  // an incremental tick would wipe history and only rewrite a narrower slice.
  // A `since` earlier than the lookback extends the window; a later `since`
  // is ignored.
  private windowStartDate(options: SyncOptions): string {
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const now = Date.now();
    let startMs = now - (lookbackDays - 1) * MS_PER_DAY;
    if (options.since) {
      const sinceMs = new Date(options.since).getTime();
      if (Number.isFinite(sinceMs) && sinceMs < startMs) {
        startMs = sinceMs;
      }
    }
    return new Date(startMs).toISOString().slice(0, 10);
  }

  private runQuery<T>(
    query: Record<string, unknown>,
    resource: PostHogPhase,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.post<T>(
      `${this.baseUrl}/api/projects/${this.settings.projectId}/query`,
      {
        resource,
        headers: this.buildHeaders(),
        body: JSON.stringify({ query }),
        signal,
      },
    ).then((res) => res.body);
  }

  // -------------------------------------------------------------------------
  // feature_flags — paginated REST list (entities)
  // -------------------------------------------------------------------------

  private async fetchFeatureFlagsPage(
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const offset = safeOffset(page);
    const url = new URL(
      `${this.baseUrl}/api/projects/${this.settings.projectId}/feature_flags/`,
    );
    url.searchParams.set('limit', String(FLAGS_PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    const res = await this.get<FeatureFlagListResponse>(url.toString(), {
      resource: 'feature_flags',
      headers: this.buildHeaders(),
      signal,
    });
    const results = res.body.results;
    // Build the next offset ourselves rather than echoing the API's absolute
    // `next` URL back into fetch(), avoiding any SSRF surface from a tampered
    // cursor while still stopping once a short page comes back.
    const next =
      res.body.next && results.length === FLAGS_PAGE_SIZE
        ? String(offset + FLAGS_PAGE_SIZE)
        : null;
    return { items: results, next };
  }

  private async writeFeatureFlags(
    storage: StorageHandle,
    items: FeatureFlagRecord[],
  ): Promise<void> {
    for (const flag of items) {
      await storage.entity({
        type: FEATURE_FLAG_ENTITY,
        id: String(flag.id),
        attributes: {
          key: flag.key,
          name: flag.name ?? null,
          active: flag.active,
          rolloutPercentage: finiteNumberOrNull(flag.rollout_percentage),
          filters: stringifyFilters(flag.filters),
        },
        updated_at: parseEpoch(flag.created_at ?? null, 'iso') ?? 0,
      });
    }
  }

  // -------------------------------------------------------------------------
  // events_per_day — HogQL grouped by (day, event)
  // -------------------------------------------------------------------------

  private async fetchEventsPerDay(
    startDate: string,
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const offset = safeOffset(page);
    const clauses = [`timestamp >= toDateTime(${quoteHogQLString(startDate)})`];
    const events = this.settings.events;
    if (events && events.length > 0) {
      const list = events.map(quoteHogQLString).join(', ');
      clauses.push(`event IN (${list})`);
    }
    const sql =
      `SELECT toString(toDate(timestamp)) AS day, event AS event, ` +
      `count() AS total, count(DISTINCT person_id) AS users ` +
      `FROM events WHERE ${clauses.join(' AND ')} ` +
      `GROUP BY day, event ORDER BY day, event ` +
      `LIMIT ${QUERY_PAGE_SIZE} OFFSET ${offset}`;
    const body = await this.runQuery<HogQLResponse>(
      { kind: 'HogQLQuery', query: sql },
      'events_per_day',
      signal,
    );
    const next =
      body.results.length === QUERY_PAGE_SIZE
        ? String(offset + QUERY_PAGE_SIZE)
        : null;
    return { items: body.results, next };
  }

  private async writeEventsPerDay(
    storage: StorageHandle,
    rows: HogQLResponse['results'],
  ): Promise<void> {
    for (const row of rows) {
      const ts = dateStringToMs(row[0]);
      if (ts === null) {
        continue;
      }
      const count = finiteNumber(row[2]);
      await storage.metric({
        name: EVENTS_PER_DAY_METRIC,
        ts,
        value: count,
        attributes: {
          event: stringOrNull(row[1]),
          count,
          distinctUsers: finiteNumber(row[3]),
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // feature_flag_usage — HogQL over $feature_flag_called events
  // -------------------------------------------------------------------------

  private async fetchFlagUsage(
    startDate: string,
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const offset = safeOffset(page);
    const sql =
      `SELECT toString(toDate(timestamp)) AS day, ` +
      `properties.$feature_flag AS flag, count() AS calls, ` +
      `count(DISTINCT person_id) AS users FROM events ` +
      `WHERE event = '$feature_flag_called' AND ` +
      `timestamp >= toDateTime(${quoteHogQLString(startDate)}) ` +
      `GROUP BY day, flag ORDER BY day, flag ` +
      `LIMIT ${QUERY_PAGE_SIZE} OFFSET ${offset}`;
    const body = await this.runQuery<HogQLResponse>(
      { kind: 'HogQLQuery', query: sql },
      'feature_flag_usage',
      signal,
    );
    const next =
      body.results.length === QUERY_PAGE_SIZE
        ? String(offset + QUERY_PAGE_SIZE)
        : null;
    return { items: body.results, next };
  }

  private async writeFlagUsage(
    storage: StorageHandle,
    rows: HogQLResponse['results'],
  ): Promise<void> {
    for (const row of rows) {
      const ts = dateStringToMs(row[0]);
      if (ts === null) {
        continue;
      }
      const callCount = finiteNumber(row[2]);
      await storage.metric({
        name: FLAG_USAGE_METRIC,
        ts,
        value: callCount,
        attributes: {
          flagKey: stringOrNull(row[1]),
          callCount,
          uniqueUsers: finiteNumber(row[3]),
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // active_users — TrendsQuery (dau / wau / mau)
  // -------------------------------------------------------------------------

  private async fetchActiveUsers(
    startDate: string,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: null }> {
    const body = await this.runQuery<TrendsResponse>(
      {
        kind: 'TrendsQuery',
        dateRange: { date_from: startDate },
        interval: 'day',
        series: ACTIVE_USER_MATH.map((math) => ({
          kind: 'EventsNode',
          event: null,
          math,
        })),
      },
      'active_users',
      signal,
    );
    return { items: body.results, next: null };
  }

  private async writeActiveUsers(
    storage: StorageHandle,
    series: TrendsResponse['results'],
  ): Promise<void> {
    for (let i = 0; i < series.length; i++) {
      const entry = series[i]!;
      const window = ACTIVE_USER_WINDOWS[i] ?? `series_${i}`;
      const data = entry.data ?? [];
      const days = entry.days ?? [];
      const n = Math.min(data.length, days.length);
      for (let j = 0; j < n; j++) {
        const ts = dateStringToMs(days[j]);
        if (ts === null) {
          continue;
        }
        await storage.metric({
          name: ACTIVE_USERS_METRIC,
          ts,
          value: finiteNumber(data[j]),
          attributes: { window },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // funnels — one FunnelsQuery per declared funnel (index-paged)
  // -------------------------------------------------------------------------

  private async fetchFunnelPage(
    page: string | null,
    startDate: string,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const funnels = this.settings.funnels ?? [];
    const index = safeOffset(page);
    if (index >= funnels.length) {
      return { items: [], next: null };
    }
    const funnel = funnels[index]!;
    const body = await this.runQuery<FunnelResponse>(
      {
        kind: 'FunnelsQuery',
        dateRange: { date_from: startDate },
        series: funnel.steps.map((event) => ({ kind: 'EventsNode', event })),
        funnelWindowInterval: funnel.windowDays ?? DEFAULT_FUNNEL_WINDOW_DAYS,
        funnelWindowIntervalUnit: 'day',
      },
      'funnels',
      signal,
    );
    // Tag each step row with its funnel so writeBatch stays stateless.
    const items = body.results.map((step) => ({ funnel, step }));
    const next = index + 1 < funnels.length ? String(index + 1) : null;
    return { items, next };
  }

  private async writeFunnelSteps(
    storage: StorageHandle,
    items: Array<{ funnel: PostHogFunnel; step: FunnelStepResult }>,
  ): Promise<void> {
    // Snapshot timestamp: funnel conversion is measured over the whole window,
    // so stamp every step at the start of the current UTC day.
    const ts = startOfUtcDay(Date.now());
    for (const { funnel, step } of items) {
      const users = finiteNumber(step.count);
      const base = items.find(
        (it) => it.funnel === funnel && (it.step.order ?? 0) === 0,
      )?.step.count;
      const baseUsers = finiteNumber(base);
      const conversionRate = baseUsers > 0 ? users / baseUsers : 0;
      await storage.metric({
        name: FUNNEL_METRIC,
        ts,
        value: users,
        attributes: {
          funnel: funnel.name,
          step: finiteNumber(step.order),
          stepName: stringOrNull(step.name),
          users,
          conversionRate,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Scope clearing (idempotency)
  // -------------------------------------------------------------------------

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: PostHogPhase,
    isFull: boolean,
  ): Promise<void> {
    switch (phase) {
      case 'feature_flags':
        // Entities upsert by id; only a full backfill drops stale rows.
        if (isFull) {
          await storage.entities([], { types: [FEATURE_FLAG_ENTITY] });
        }
        return;
      case 'events_per_day':
        await storage.metrics([], { names: [EVENTS_PER_DAY_METRIC] });
        return;
      case 'feature_flag_usage':
        await storage.metrics([], { names: [FLAG_USAGE_METRIC] });
        return;
      case 'active_users':
        await storage.metrics([], { names: [ACTIVE_USERS_METRIC] });
        return;
      case 'funnels':
        await storage.metrics([], { names: [FUNNEL_METRIC] });
        return;
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: PostHogPhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'feature_flags':
        await this.writeFeatureFlags(storage, items as FeatureFlagRecord[]);
        return;
      case 'events_per_day':
        await this.writeEventsPerDay(
          storage,
          items as HogQLResponse['results'],
        );
        return;
      case 'feature_flag_usage':
        await this.writeFlagUsage(storage, items as HogQLResponse['results']);
        return;
      case 'active_users':
        await this.writeActiveUsers(
          storage,
          items as TrendsResponse['results'],
        );
        return;
      case 'funnels':
        await this.writeFunnelSteps(
          storage,
          items as Array<{ funnel: PostHogFunnel; step: FunnelStepResult }>,
        );
        return;
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isPostHogSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const startDate = this.windowStartDate(options);

    const phases = selectActivePhases<PostHogResource, PostHogPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<PostHogPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'feature_flags':
            return this.fetchFeatureFlagsPage(page, sig);
          case 'events_per_day':
            return this.fetchEventsPerDay(startDate, page, sig);
          case 'feature_flag_usage':
            return this.fetchFlagUsage(startDate, page, sig);
          case 'active_users':
            return this.fetchActiveUsers(startDate, sig);
          case 'funnels':
            return this.fetchFunnelPage(page, startDate, sig);
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
