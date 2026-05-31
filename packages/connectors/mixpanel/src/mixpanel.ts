import { connectorUserAgent } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorCost,
  type ConnectorDoc,
  type CredentialsSchema,
  type JSONValue,
  type MetricSample,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  schemasFromResources,
} from '@rawdash/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const funnelSpec = z.object({
  id: z.union([z.string().min(1), z.number().int().positive()]).meta({
    label: 'Funnel ID',
    description: 'Numeric funnel ID (as shown in Mixpanel report URLs).',
  }),
  name: z.string().min(1).optional().meta({
    label: 'Funnel display name',
    description: 'Optional label attached to each metric sample.',
  }),
});

export const configFields = defineConfigFields(
  z.object({
    username: z.string().min(1).meta({
      label: 'Service account username',
      description:
        'Mixpanel service account username (e.g. `rawdash-reader.abcdef.mp-service-account`). Create one at Project settings → Service Accounts.',
    }),
    secret: z.object({ $secret: z.string() }).meta({
      label: 'Service account secret',
      description:
        'Mixpanel service account secret, paired with the username via HTTP Basic auth.',
      secret: true,
    }),
    projectId: z
      .string()
      .trim()
      .regex(/^\d+$/, 'projectId must be a Mixpanel numeric project ID')
      .meta({
        label: 'Project ID',
        description:
          'Numeric Mixpanel project ID. Found under Project settings → Overview.',
        placeholder: '1234567',
      }),
    region: z.enum(['us', 'eu']).optional().meta({
      label: 'Data residency region',
      description: 'Mixpanel API region. Defaults to `us`.',
    }),
    events: z.array(z.string().min(1)).optional().meta({
      label: 'Events to track',
      description:
        'Event names to fetch per-day volume and unique-user counts for. Each event runs one segmentation query per sync per type.',
    }),
    funnels: z.array(funnelSpec).optional().meta({
      label: 'Funnels',
      description:
        'Mixpanel funnels to sync per-day conversion data for. Add one entry per funnel ID.',
    }),
    retentionEvent: z.string().min(1).optional().meta({
      label: 'Retention event',
      description:
        'Event name to use for cohort retention. When set, the connector runs a single retention query per sync.',
    }),
    activeUserEvent: z.string().min(1).optional().meta({
      label: 'Active-user event',
      description:
        'Event name used for DAU/WAU/MAU unique-user counts. Defaults to the first entry in `events` when unset.',
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Backfill window (days)',
      description: 'How many days to fetch on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Mixpanel',
  category: 'analytics',
  brandColor: '#7856FF',
  tagline:
    'Sync Mixpanel active-user counts, per-event volume, funnel conversion, and cohort retention as metric time series.',
  vendor: {
    name: 'Mixpanel',
    apiDocs: 'https://developer.mixpanel.com/reference/query-api',
    website: 'https://mixpanel.com',
  },
  auth: {
    summary:
      'Authenticate with a Mixpanel service account (username + secret) over HTTP Basic auth, scoped to a numeric project ID.',
    setup: [
      'In Mixpanel, open Project settings → Service Accounts and create a service account with at least read access to the project.',
      'Copy the generated username (e.g. `rawdash-reader.abcdef.mp-service-account`) and the secret shown once at creation.',
      'Find the numeric project ID under Project settings → Overview and set it as `projectId`.',
      'Store the secret and reference it from config as `secret: secret("MIXPANEL_SECRET")`, alongside the `username`.',
      'For EU-resident projects, set `region: "eu"`.',
    ],
  },
  rateLimit:
    "Mixpanel's Query API quota is 60 queries/hour per project (default); requests are retried with backoff.",
  limitations: [
    'Incremental syncs refetch a 3-day overlap because Mixpanel can re-attribute late-arriving events.',
  ],
});

export const cost: ConnectorCost = {
  warning:
    'Each configured event and funnel costs one or more queries per sync against Mixpanel quotas; adding many events/funnels or syncing frequently can exhaust the quota.',
};

// ---------------------------------------------------------------------------
// Settings / credentials
// ---------------------------------------------------------------------------

export interface MixpanelFunnelSpec {
  id: string | number;
  name?: string;
}

export interface MixpanelSettings {
  projectId: string;
  region?: 'us' | 'eu';
  events?: readonly string[];
  funnels?: readonly MixpanelFunnelSpec[];
  retentionEvent?: string;
  activeUserEvent?: string;
  lookbackDays?: number;
}

const mixpanelCredentials = {
  username: {
    description: 'Mixpanel service account username',
    auth: 'required' as const,
  },
  secret: {
    description: 'Mixpanel service account secret',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type MixpanelCredentials = typeof mixpanelCredentials;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LOOKBACK_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 3;
const MS_PER_DAY = 86_400_000;

const PHASE_ORDER = [
  'dau',
  'wau',
  'mau',
  'events_per_day',
  'funnel_results',
  'retention',
] as const;

export type MixpanelPhase = (typeof PHASE_ORDER)[number];
export type MixpanelResource = MixpanelPhase;

const METRIC_NAMES: Record<MixpanelPhase, string> = {
  dau: 'mixpanel_dau',
  wau: 'mixpanel_wau',
  mau: 'mixpanel_mau',
  events_per_day: 'mixpanel_events_per_day',
  funnel_results: 'mixpanel_funnel_results',
  retention: 'mixpanel_retention',
};

const PHASE_UNIT: Record<'dau' | 'wau' | 'mau', 'day' | 'week' | 'month'> = {
  dau: 'day',
  wau: 'week',
  mau: 'month',
};

// ---------------------------------------------------------------------------
// Cursor + helpers
// ---------------------------------------------------------------------------

interface MixpanelDateRange {
  from: string;
  to: string;
}

interface MixpanelSyncCursor {
  phase: MixpanelPhase;
  dateRange: MixpanelDateRange;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value);
}

function isDateRange(value: unknown): value is MixpanelDateRange {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { from?: unknown; to?: unknown };
  return isDateString(v.from) && isDateString(v.to);
}

function isMixpanelSyncCursor(value: unknown): value is MixpanelSyncCursor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { phase?: unknown; dateRange?: unknown };
  if (typeof v.phase !== 'string') {
    return false;
  }
  if (!(PHASE_ORDER as readonly string[]).includes(v.phase)) {
    return false;
  }
  return isDateRange(v.dateRange);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toMixpanelDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function mixpanelDateToMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) {
    return NaN;
  }
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function getDateRange(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): MixpanelDateRange {
  const to = toMixpanelDate(now);
  if (options.mode === 'latest') {
    return {
      from: toMixpanelDate(now - (INCREMENTAL_LOOKBACK_DAYS - 1) * MS_PER_DAY),
      to,
    };
  }
  if (options.since !== undefined) {
    const sinceMs = Date.parse(options.since);
    if (Number.isFinite(sinceMs)) {
      const elapsed = Math.max(1, Math.ceil((now - sinceMs) / MS_PER_DAY));
      const days = Math.min(elapsed, lookbackDays);
      return { from: toMixpanelDate(now - (days - 1) * MS_PER_DAY), to };
    }
  }
  return {
    from: toMixpanelDate(now - (lookbackDays - 1) * MS_PER_DAY),
    to,
  };
}

// ---------------------------------------------------------------------------
// Mixpanel response shapes (permissive — wire format is JSON, validated by
// the per-resource Zod schemas below before sample extraction)
// ---------------------------------------------------------------------------

export interface SegmentationResponse {
  legend_size?: number;
  data: {
    series: string[];
    values: Record<string, Record<string, number>>;
  };
}

export interface FunnelStep {
  step_label?: string;
  goal?: string;
  event?: string;
  count: number;
  overall_conv_ratio?: number;
  step_conv_ratio?: number;
}

export interface FunnelDateBucket {
  steps: FunnelStep[];
  analysis?: {
    completion?: number;
    starting_amount?: number;
    steps?: number;
    worst?: number;
  };
}

export interface FunnelResponse {
  meta?: { dates?: string[] };
  data: Record<string, FunnelDateBucket>;
}

export interface RetentionCohort {
  first: number;
  counts: number[];
}

export type RetentionResponse = Record<string, RetentionCohort>;

// ---------------------------------------------------------------------------
// Zod schemas — describe each resource's wire shape
// ---------------------------------------------------------------------------

const dateString = z.string().regex(DATE_RE);
const finiteNumber = z.number();

const segmentationSchema = z.object({
  legend_size: z.number().optional(),
  data: z.object({
    series: z.array(dateString),
    values: z.record(z.string(), z.record(dateString, finiteNumber)),
  }),
});

const funnelStepSchema = z.object({
  step_label: z.string().optional(),
  goal: z.string().optional(),
  event: z.string().optional(),
  count: finiteNumber,
  overall_conv_ratio: finiteNumber.optional(),
  step_conv_ratio: finiteNumber.optional(),
});

const funnelSchema = z.object({
  meta: z.object({ dates: z.array(dateString).optional() }).optional(),
  data: z.record(
    dateString,
    z.object({
      steps: z.array(funnelStepSchema),
      analysis: z
        .object({
          completion: finiteNumber.optional(),
          starting_amount: finiteNumber.optional(),
          steps: finiteNumber.optional(),
          worst: finiteNumber.optional(),
        })
        .optional(),
    }),
  ),
});

const retentionSchema = z.record(
  dateString,
  z.object({
    first: finiteNumber,
    counts: z.array(finiteNumber),
  }),
);

const METRIC_NOTES =
  'Each metric is rewritten in full per sync (idempotent replace).';

const mixpanelResources = defineResources({
  mixpanel_dau: {
    shape: 'metric',
    description:
      'Daily active users - unique-user counts for the active-user event, one sample per day.',
    endpoint: 'GET /api/2.0/segmentation (type=unique, unit=day)',
    unit: 'users',
    granularity: 'day',
    notes: METRIC_NOTES,
    dimensions: [
      { name: 'unit', description: 'Active-user window: always `day`.' },
      {
        name: 'event',
        description: 'The event the active-user count is based on.',
      },
    ],
    responses: { dau: segmentationSchema },
  },
  mixpanel_wau: {
    shape: 'metric',
    description:
      'Weekly active users - unique-user counts for the active-user event, one sample per week.',
    endpoint: 'GET /api/2.0/segmentation (type=unique, unit=week)',
    unit: 'users',
    granularity: 'week',
    notes: METRIC_NOTES,
    dimensions: [
      { name: 'unit', description: 'Active-user window: always `week`.' },
      {
        name: 'event',
        description: 'The event the active-user count is based on.',
      },
    ],
    responses: { wau: segmentationSchema },
  },
  mixpanel_mau: {
    shape: 'metric',
    description:
      'Monthly active users - unique-user counts for the active-user event, one sample per month.',
    endpoint: 'GET /api/2.0/segmentation (type=unique, unit=month)',
    unit: 'users',
    granularity: 'month',
    notes: METRIC_NOTES,
    dimensions: [
      { name: 'unit', description: 'Active-user window: always `month`.' },
      {
        name: 'event',
        description: 'The event the active-user count is based on.',
      },
    ],
    responses: { mau: segmentationSchema },
  },
  mixpanel_events_per_day: {
    shape: 'metric',
    description:
      'Per-day volume for each configured event. The sample value is the total event count; unique-user count is carried as an attribute.',
    endpoint: 'GET /api/2.0/segmentation (type=general and type=unique)',
    unit: 'events',
    granularity: 'day',
    notes: METRIC_NOTES,
    dimensions: [
      { name: 'event', description: 'The configured event name.' },
      {
        name: 'count',
        description: 'Total event count for the day (equals the value).',
      },
      {
        name: 'uniqueUsers',
        description: 'Distinct users who triggered the event that day.',
      },
    ],
    responses: { events_per_day: segmentationSchema },
  },
  mixpanel_funnel_results: {
    shape: 'metric',
    description:
      'Per-day funnel conversion. One sample per (date, step); the value is the user count reaching that step.',
    endpoint: 'GET /api/2.0/funnels (unit=day)',
    unit: 'users',
    granularity: 'day',
    notes: METRIC_NOTES,
    dimensions: [
      { name: 'funnelId', description: 'The configured Mixpanel funnel ID.' },
      {
        name: 'funnelName',
        description: 'Optional display name from config (present when set).',
      },
      { name: 'step', description: 'Zero-based step index in the funnel.' },
      {
        name: 'stepLabel',
        description: 'Human-readable step label or event name.',
      },
      { name: 'users', description: 'Users reaching this step.' },
      {
        name: 'conversionRate',
        description: 'Overall conversion ratio from the first step.',
      },
      {
        name: 'stepConversionRate',
        description: 'Conversion ratio from the previous step.',
      },
    ],
    responses: { funnel_results: funnelSchema },
  },
  mixpanel_retention: {
    shape: 'metric',
    description:
      'Cohort retention for the retention event. One sample per (cohort date, period); the value is the retained user count.',
    endpoint: 'GET /api/2.0/retention (retention_type=birth, unit=day)',
    unit: 'users',
    granularity: 'day',
    notes: METRIC_NOTES,
    dimensions: [
      { name: 'event', description: 'The retention (born) event.' },
      {
        name: 'period',
        description: 'Days since the cohort birth date (period index).',
      },
      {
        name: 'cohortSize',
        description: 'Number of users in the cohort at birth.',
      },
      {
        name: 'retentionRate',
        description: 'Retained users divided by cohort size.',
      },
    ],
    responses: { retention: retentionSchema },
  },
});

// ---------------------------------------------------------------------------
// Sample extraction (pure, exported for unit tests)
// ---------------------------------------------------------------------------

export function buildActiveUserSamples(
  response: SegmentationResponse,
  metricName: string,
  unit: 'day' | 'week' | 'month',
  event: string,
): MetricSample[] {
  const samples: MetricSample[] = [];
  const seriesByEvent = response.data.values;
  // Mixpanel returns values keyed by the queried event name; merge across keys
  // so a single sample per date is emitted regardless of how many event keys
  // appear in the response.
  const dateTotals = new Map<string, number>();
  for (const eventValues of Object.values(seriesByEvent)) {
    for (const [date, value] of Object.entries(eventValues)) {
      const ts = mixpanelDateToMs(date);
      if (!Number.isFinite(ts)) {
        continue;
      }
      const prior = dateTotals.get(date) ?? 0;
      dateTotals.set(date, prior + value);
    }
  }
  for (const [date, value] of dateTotals) {
    const ts = mixpanelDateToMs(date);
    samples.push({
      name: metricName,
      ts,
      value,
      attributes: { unit, event },
    });
  }
  return samples;
}

export function buildEventsPerDaySamples(
  generalResponse: SegmentationResponse,
  uniqueResponse: SegmentationResponse,
  event: string,
): MetricSample[] {
  const samples: MetricSample[] = [];
  const generalValues = generalResponse.data.values[event] ?? {};
  const uniqueValues = uniqueResponse.data.values[event] ?? {};
  const allDates = new Set<string>([
    ...Object.keys(generalValues),
    ...Object.keys(uniqueValues),
  ]);
  for (const date of allDates) {
    const ts = mixpanelDateToMs(date);
    if (!Number.isFinite(ts)) {
      continue;
    }
    const count = generalValues[date] ?? 0;
    const uniqueUsers = uniqueValues[date] ?? 0;
    samples.push({
      name: METRIC_NAMES.events_per_day,
      ts,
      value: count,
      attributes: {
        event,
        count,
        uniqueUsers,
      },
    });
  }
  return samples;
}

export function buildFunnelSamples(
  response: FunnelResponse,
  funnel: MixpanelFunnelSpec,
): MetricSample[] {
  const samples: MetricSample[] = [];
  const funnelIdAttr: JSONValue =
    typeof funnel.id === 'number' ? funnel.id : String(funnel.id);
  for (const [date, bucket] of Object.entries(response.data)) {
    const ts = mixpanelDateToMs(date);
    if (!Number.isFinite(ts)) {
      continue;
    }
    bucket.steps.forEach((step, stepIdx) => {
      const attributes: Record<string, JSONValue> = {
        funnelId: funnelIdAttr,
        step: stepIdx,
        stepLabel: step.step_label ?? step.event ?? `step_${stepIdx}`,
        users: step.count,
        conversionRate: step.overall_conv_ratio ?? null,
        stepConversionRate: step.step_conv_ratio ?? null,
      };
      if (funnel.name !== undefined) {
        attributes['funnelName'] = funnel.name;
      }
      samples.push({
        name: METRIC_NAMES.funnel_results,
        ts,
        value: step.count,
        attributes,
      });
    });
  }
  return samples;
}

export function buildRetentionSamples(
  response: RetentionResponse,
  event: string,
): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const [cohortDate, cohort] of Object.entries(response)) {
    const ts = mixpanelDateToMs(cohortDate);
    if (!Number.isFinite(ts)) {
      continue;
    }
    cohort.counts.forEach((retained, period) => {
      samples.push({
        name: METRIC_NAMES.retention,
        ts,
        value: retained,
        attributes: {
          event,
          period,
          cohortSize: cohort.first,
          retentionRate: cohort.first > 0 ? retained / cohort.first : 0,
        },
      });
    });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function encodeBasicAuth(username: string, secret: string): string {
  const raw = `${username}:${secret}`;
  if (typeof btoa === 'function') {
    return `Basic ${btoa(raw)}`;
  }
  const bufferCtor = (
    globalThis as {
      Buffer?: { from: (s: string) => { toString: (enc: string) => string } };
    }
  ).Buffer;
  if (bufferCtor) {
    return `Basic ${bufferCtor.from(raw).toString('base64')}`;
  }
  throw new Error('No base64 encoder available in this runtime');
}

function regionHost(region: 'us' | 'eu' | undefined): string {
  return region === 'eu' ? 'eu.mixpanel.com' : 'mixpanel.com';
}

// ---------------------------------------------------------------------------
// MixpanelConnector
// ---------------------------------------------------------------------------

export class MixpanelConnector extends BaseConnector<
  MixpanelSettings,
  MixpanelCredentials
> {
  static readonly id = 'mixpanel';

  static readonly resources = mixpanelResources;

  static readonly schemas = schemasFromResources(mixpanelResources);

  static readonly cost: ConnectorCost = cost;

  static create(input: unknown, ctx?: ConnectorContext): MixpanelConnector {
    const parsed = configFields.parse(input);
    return new MixpanelConnector(
      {
        projectId: parsed.projectId,
        region: parsed.region,
        events: parsed.events,
        funnels: parsed.funnels,
        retentionEvent: parsed.retentionEvent,
        activeUserEvent: parsed.activeUserEvent,
        lookbackDays: parsed.lookbackDays,
      },
      {
        username: parsed.username,
        secret: parsed.secret,
      },
      ctx,
    );
  }

  readonly id = 'mixpanel';
  override readonly credentials = mixpanelCredentials;

  private get apiBase(): string {
    return `https://${regionHost(this.settings.region)}/api/2.0`;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: encodeBasicAuth(this.creds.username, this.creds.secret),
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('mixpanel'),
    };
  }

  private buildQuery(extra: Record<string, string>): string {
    const params = new URLSearchParams({
      project_id: this.settings.projectId,
      ...extra,
    });
    return params.toString();
  }

  private async getSegmentation(
    resource: MixpanelPhase,
    params: Record<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<SegmentationResponse> {
    const url = `${this.apiBase}/segmentation?${this.buildQuery(params)}`;
    const res = await this.get<unknown>(url, {
      resource,
      headers: this.authHeaders(),
      signal,
    });
    return segmentationSchema.parse(res.body);
  }

  private async getFunnel(
    funnelId: string | number,
    range: MixpanelDateRange,
    signal: AbortSignal | undefined,
  ): Promise<FunnelResponse> {
    const url = `${this.apiBase}/funnels?${this.buildQuery({
      funnel_id: String(funnelId),
      from_date: range.from,
      to_date: range.to,
      unit: 'day',
    })}`;
    const res = await this.get<unknown>(url, {
      resource: 'funnel_results',
      headers: this.authHeaders(),
      signal,
    });
    return funnelSchema.parse(res.body);
  }

  private async getRetention(
    event: string,
    range: MixpanelDateRange,
    signal: AbortSignal | undefined,
  ): Promise<RetentionResponse> {
    const url = `${this.apiBase}/retention?${this.buildQuery({
      from_date: range.from,
      to_date: range.to,
      retention_type: 'birth',
      unit: 'day',
      born_event: event,
      event,
    })}`;
    const res = await this.get<unknown>(url, {
      resource: 'retention',
      headers: this.authHeaders(),
      signal,
    });
    return retentionSchema.parse(res.body);
  }

  private resolveActiveUserEvent(): string | undefined {
    if (this.settings.activeUserEvent !== undefined) {
      return this.settings.activeUserEvent;
    }
    const first = this.settings.events?.[0];
    return first;
  }

  private async runActiveUserPhase(
    phase: 'dau' | 'wau' | 'mau',
    range: MixpanelDateRange,
    storage: StorageHandle,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const metricName = METRIC_NAMES[phase];
    const event = this.resolveActiveUserEvent();
    if (event === undefined) {
      // No configured event to base active-user counts on; clear and skip.
      await storage.metrics([], { names: [metricName] });
      return;
    }
    const response = await this.getSegmentation(
      phase,
      {
        event,
        from_date: range.from,
        to_date: range.to,
        unit: PHASE_UNIT[phase],
        type: 'unique',
      },
      signal,
    );
    const samples = buildActiveUserSamples(
      response,
      metricName,
      PHASE_UNIT[phase],
      event,
    );
    await storage.metrics(samples, { names: [metricName] });
  }

  private async runEventsPerDayPhase(
    range: MixpanelDateRange,
    storage: StorageHandle,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const metricName = METRIC_NAMES.events_per_day;
    const events = this.settings.events ?? [];
    if (events.length === 0) {
      await storage.metrics([], { names: [metricName] });
      return;
    }
    const samples: MetricSample[] = [];
    for (const event of events) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const [generalResponse, uniqueResponse] = await Promise.all([
        this.getSegmentation(
          'events_per_day',
          {
            event,
            from_date: range.from,
            to_date: range.to,
            unit: 'day',
            type: 'general',
          },
          signal,
        ),
        this.getSegmentation(
          'events_per_day',
          {
            event,
            from_date: range.from,
            to_date: range.to,
            unit: 'day',
            type: 'unique',
          },
          signal,
        ),
      ]);
      samples.push(
        ...buildEventsPerDaySamples(generalResponse, uniqueResponse, event),
      );
    }
    await storage.metrics(samples, { names: [metricName] });
  }

  private async runFunnelPhase(
    range: MixpanelDateRange,
    storage: StorageHandle,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const metricName = METRIC_NAMES.funnel_results;
    const funnels = this.settings.funnels ?? [];
    if (funnels.length === 0) {
      await storage.metrics([], { names: [metricName] });
      return;
    }
    const samples: MetricSample[] = [];
    for (const funnel of funnels) {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
      const response = await this.getFunnel(funnel.id, range, signal);
      samples.push(...buildFunnelSamples(response, funnel));
    }
    await storage.metrics(samples, { names: [metricName] });
  }

  private async runRetentionPhase(
    range: MixpanelDateRange,
    storage: StorageHandle,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const metricName = METRIC_NAMES.retention;
    const event = this.settings.retentionEvent;
    if (event === undefined) {
      await storage.metrics([], { names: [metricName] });
      return;
    }
    const response = await this.getRetention(event, range, signal);
    const samples = buildRetentionSamples(response, event);
    await storage.metrics(samples, { names: [metricName] });
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const cursor = isMixpanelSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    // Restore the originally-computed window on resume so phases stay aligned
    // across midnight rollovers and lookbackDays changes between runs.
    const dateRange = cursor?.dateRange ?? getDateRange(options, lookbackDays);

    const resumeIdx = cursor ? PHASE_ORDER.indexOf(cursor.phase) : -1;
    const startIdx = resumeIdx >= 0 ? resumeIdx : 0;
    const requested = options.resources;

    for (let i = startIdx; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i]!;
      if (signal?.aborted) {
        return { done: false, cursor: { phase, dateRange } };
      }
      if (requested && requested.size > 0 && !requested.has(phase)) {
        continue;
      }
      const phaseStart = Date.now();
      try {
        if (phase === 'dau' || phase === 'wau' || phase === 'mau') {
          await this.runActiveUserPhase(phase, dateRange, storage, signal);
        } else if (phase === 'events_per_day') {
          await this.runEventsPerDayPhase(dateRange, storage, signal);
        } else if (phase === 'funnel_results') {
          await this.runFunnelPhase(dateRange, storage, signal);
        } else {
          await this.runRetentionPhase(dateRange, storage, signal);
        }
      } catch (err) {
        if (
          signal?.aborted ||
          (err instanceof Error && err.name === 'AbortError')
        ) {
          return { done: false, cursor: { phase, dateRange } };
        }
        this.logger.warn('fetch page failed', {
          resource: phase,
          page: 1,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          done: false,
          cursor: { phase, dateRange },
          transientError: err,
        };
      }
      this.logger.info('resource done', {
        resource: phase,
        pages: 1,
        items: 0,
        duration_ms: Date.now() - phaseStart,
      });
    }

    return { done: true };
  }
}
