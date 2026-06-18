import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
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
  metricSample,
  paginateChunked,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    publicKey: z.string().trim().min(1).meta({
      label: 'Public key',
      description:
        'Langfuse public API key for the project (starts with `pk-lf-`). Created in Langfuse -> Settings -> API Keys.',
      placeholder: 'pk-lf-...',
    }),
    secretKey: z.object({ $secret: z.string() }).meta({
      label: 'Secret key',
      description:
        'Langfuse secret API key for the project (starts with `sk-lf-`). Issued alongside the public key in Langfuse -> Settings -> API Keys.',
      placeholder: 'sk-lf-...',
      secret: true,
    }),
    host: z
      .string()
      .trim()
      .regex(
        /^https?:\/\/[^\s/]+$/,
        'Use a base URL with protocol and no trailing slash, e.g. https://cloud.langfuse.com',
      )
      .default('https://cloud.langfuse.com')
      .meta({
        label: 'Host',
        description:
          'Langfuse instance base URL. Use https://cloud.langfuse.com (US) or https://us.cloud.langfuse.com / https://eu.cloud.langfuse.com for Langfuse Cloud, or your self-hosted origin. No trailing slash.',
        placeholder: 'https://cloud.langfuse.com',
      }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many calendar days of history to backfill on a full sync. Defaults to 30.',
      placeholder: '30',
    }),
    resources: z
      .array(z.enum(['traces', 'observations_per_day', 'scores']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Langfuse resources to sync. Omit to sync all of them.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Langfuse',
  category: 'engineering',
  brandColor: '#1F2937',
  tagline:
    'Sync LLM traces, daily observation volume and cost by model, and feedback scores from a Langfuse project.',
  vendor: {
    name: 'Langfuse',
    domain: 'langfuse.com',
    apiDocs: 'https://api.reference.langfuse.com',
    website: 'https://langfuse.com',
  },
  auth: {
    summary:
      'A Langfuse public + secret API key pair scoped to one project is required. The connector authenticates over HTTP Basic auth (`publicKey:secretKey`).',
    setup: [
      'Open Langfuse -> Settings -> API Keys and create a new key pair for the project you want to sync.',
      'Copy both the public key (`pk-lf-...`) and the secret key (`sk-lf-...`). The secret is shown once.',
      'Set `host` to your instance base URL - `https://cloud.langfuse.com` (or the US/EU regional variants) for Langfuse Cloud, or your self-hosted origin (no trailing slash).',
      'Store the secret as a secret and reference it from config as `secretKey: secret("LANGFUSE_SECRET_KEY")`, alongside the plaintext `publicKey`.',
    ],
  },
  rateLimit:
    'Langfuse Cloud applies per-project rate limits (around 1000 requests/min on paid plans); 429 responses with Retry-After are honored.',
  limitations: [
    'One key pair scopes the sync to a single Langfuse project; sync multiple projects by adding one connector instance per project.',
    'Trace bodies (input/output payloads) are not synced - only the trace envelope plus aggregated cost / token / latency.',
    'Session and dataset endpoints are out of scope for the initial release.',
  ],
});

export interface LangfuseSettings {
  publicKey: string;
  host: string;
  lookbackDays?: number;
  resources?: readonly LangfuseResource[];
}

const langfuseCredentials = {
  secretKey: {
    description: 'Langfuse secret API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type LangfuseCredentials = typeof langfuseCredentials;

const PHASE_ORDER = ['traces', 'observations_per_day', 'scores'] as const;

type LangfusePhase = (typeof PHASE_ORDER)[number];

export type LangfuseResource = LangfusePhase;

const isLangfuseSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

interface ScoreAcc {
  count: number;
  sum: number;
  numericCount: number;
}

const TRACES_PAGE_SIZE = 50;
const METRICS_PAGE_SIZE = 50;
const SCORES_PAGE_SIZE = 50;
const CHUNK_BUDGET_MS = 25_000;
const DEFAULT_LOOKBACK_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const TRACE_ENTITY = 'langfuse_trace';
const OBSERVATIONS_METRIC = 'langfuse_observations_per_day';
const SCORES_METRIC = 'langfuse_scores';

interface TraceRecord {
  id: string;
  name?: string | null;
  projectId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  release?: string | null;
  version?: string | null;
  totalCost?: number | null;
  latency?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface TracesListResponse {
  data: TraceRecord[];
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

interface DailyUsage {
  model?: string | null;
  inputUsage?: number | null;
  outputUsage?: number | null;
  totalUsage?: number | null;
  countObservations?: number | null;
  totalCost?: number | null;
}

interface DailyMetricRecord {
  date: string;
  countTraces?: number | null;
  countObservations?: number | null;
  totalCost?: number | null;
  usage?: DailyUsage[] | null;
}

interface DailyMetricsResponse {
  data: DailyMetricRecord[];
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

interface ScoreRecord {
  id: string;
  name: string;
  value?: number | null;
  stringValue?: string | null;
  dataType?: string | null;
  source?: string | null;
  timestamp?: string | null;
  createdAt?: string | null;
}

interface ScoresListResponse {
  data: ScoreRecord[];
  meta: { page: number; limit: number; totalItems: number; totalPages: number };
}

const traceSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  projectId: z.string().nullish(),
  userId: z.string().nullish(),
  sessionId: z.string().nullish(),
  release: z.string().nullish(),
  version: z.string().nullish(),
  totalCost: z.number().nullish(),
  latency: z.number().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
});

const tracesResponseSchema = z.object({
  data: z.array(traceSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    totalItems: z.number(),
    totalPages: z.number(),
  }),
});

const dailyUsageSchema = z.object({
  model: z.string().nullish(),
  inputUsage: z.number().nullish(),
  outputUsage: z.number().nullish(),
  totalUsage: z.number().nullish(),
  countObservations: z.number().nullish(),
  totalCost: z.number().nullish(),
});

const dailyMetricSchema = z.object({
  date: z.string(),
  countTraces: z.number().nullish(),
  countObservations: z.number().nullish(),
  totalCost: z.number().nullish(),
  usage: z.array(dailyUsageSchema).nullish(),
});

const dailyMetricsResponseSchema = z.object({
  data: z.array(dailyMetricSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    totalItems: z.number(),
    totalPages: z.number(),
  }),
});

const scoreSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  value: z.number().nullish(),
  stringValue: z.string().nullish(),
  dataType: z.string().nullish(),
  source: z.string().nullish(),
  timestamp: z.string().nullish(),
  createdAt: z.string().nullish(),
});

const scoresResponseSchema = z.object({
  data: z.array(scoreSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    totalItems: z.number(),
    totalPages: z.number(),
  }),
});

export const langfuseResources = defineResources({
  langfuse_trace: {
    shape: 'entity',
    filterable: [],
    description:
      'LLM traces in the project, keyed by id, with name, owning user/session, optional release/version, aggregate cost in USD, aggregate latency in milliseconds, and the createdAt timestamp.',
    endpoint: 'GET /api/public/traces',
    notes:
      'Traces upsert by id on every run. Trace input/output payloads are not stored.',
    fields: [
      { name: 'name', description: 'Trace name set by the SDK.' },
      {
        name: 'projectId',
        description: 'Langfuse project id the trace belongs to.',
      },
      { name: 'userId', description: 'Attached userId, if any.' },
      { name: 'sessionId', description: 'Attached sessionId, if any.' },
      {
        name: 'release',
        description: 'Release identifier from the SDK, if set.',
      },
      {
        name: 'version',
        description: 'Version identifier from the SDK, if set.',
      },
      {
        name: 'totalCost',
        description: 'Aggregate trace cost in USD across all observations.',
      },
      {
        name: 'latencyMs',
        description: 'End-to-end trace latency in milliseconds.',
      },
      { name: 'createdAt', description: 'ISO timestamp of trace creation.' },
    ],
    responses: { traces: tracesResponseSchema },
  },
  langfuse_observations_per_day: {
    shape: 'metric',
    description:
      'Daily LLM observation volume, total tokens, and total cost rolled up by model from the Langfuse daily metrics endpoint. One sample per (day, model) over the lookback window.',
    endpoint: 'GET /api/public/metrics/daily',
    unit: 'observations',
    granularity: 'Daily (UTC)',
    notes: 'Rollup metrics are stamped at UTC midnight of the day they cover.',
    dimensions: [
      {
        name: 'model',
        description: 'The model id the observations ran against.',
      },
    ],
    measures: [
      {
        name: 'inputTokens',
        description: 'Input tokens consumed that day for this model.',
      },
      {
        name: 'outputTokens',
        description: 'Output tokens produced that day for this model.',
      },
      {
        name: 'totalTokens',
        description: 'Total tokens (input + output) for the day and model.',
      },
      {
        name: 'costUsd',
        description: 'Aggregate cost in USD for the day and model.',
      },
    ],
    responses: { observations_per_day: dailyMetricsResponseSchema },
  },
  langfuse_scores: {
    shape: 'metric',
    description:
      'Daily Langfuse score rollups by score name. One sample per (day, name): the mean numeric value across that day and the count of scores written.',
    endpoint: 'GET /api/public/scores',
    unit: 'scores',
    granularity: 'Daily (UTC)',
    notes:
      'Only numeric scores contribute to the average; non-numeric scores still increment the count.',
    dimensions: [
      { name: 'scoreName', description: 'Score name as set by the SDK.' },
    ],
    measures: [
      { name: 'count', description: 'Number of scores written that day.' },
    ],
    responses: { scores: scoresResponseSchema },
  },
});

export const id = 'langfuse';

export class LangfuseConnector extends BaseConnector<
  LangfuseSettings,
  LangfuseCredentials
> {
  static readonly id = id;

  static readonly resources = langfuseResources;

  static readonly schemas = schemasFromResources(langfuseResources);

  static create(input: unknown, ctx?: ConnectorContext): LangfuseConnector {
    const parsed = configFields.parse(input);
    return new LangfuseConnector(
      {
        publicKey: parsed.publicKey,
        host: parsed.host,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { secretKey: parsed.secretKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = langfuseCredentials;

  private get baseUrl(): string {
    return this.settings.host.replace(/\/+$/, '');
  }

  private buildHeaders(): Record<string, string> {
    const raw = `${this.settings.publicKey}:${this.creds.secretKey}`;
    const basic = encodeBasicAuth(raw);
    return {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('langfuse'),
    };
  }

  private windowStart(options: SyncOptions): Date {
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const now = Date.now();
    let startMs = now - lookbackDays * MS_PER_DAY;
    if (options.since) {
      const sinceMs = new Date(options.since).getTime();
      if (Number.isFinite(sinceMs) && sinceMs < startMs) {
        startMs = sinceMs;
      }
    }
    return new Date(startMs);
  }

  private async fetchTracesPage(
    options: SyncOptions,
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: TraceRecord[]; next: string | null }> {
    const pageNum = parsePage(page);
    const url = new URL(`${this.baseUrl}/api/public/traces`);
    url.searchParams.set('page', String(pageNum));
    url.searchParams.set('limit', String(TRACES_PAGE_SIZE));
    const start = this.windowStart(options);
    url.searchParams.set('fromTimestamp', start.toISOString());
    const res = await this.get<TracesListResponse>(url.toString(), {
      resource: 'traces',
      headers: this.buildHeaders(),
      signal,
    });
    const data = res.body.data;
    const sinceMs = options.since ? new Date(options.since).getTime() : null;
    const allBeforeSince =
      sinceMs !== null &&
      data.length > 0 &&
      data.every((t) => {
        const ts = parseEpoch(t.createdAt ?? null, 'iso');
        return ts !== null && ts < sinceMs;
      });
    const totalPages = res.body.meta?.totalPages ?? 0;
    const next =
      !allBeforeSince && data.length > 0 && pageNum < totalPages
        ? String(pageNum + 1)
        : null;
    return { items: data, next };
  }

  private async writeTraces(
    storage: StorageHandle,
    items: TraceRecord[],
  ): Promise<void> {
    for (const trace of items) {
      const createdAt = parseEpoch(trace.createdAt ?? null, 'iso') ?? 0;
      const updatedAt = parseEpoch(trace.updatedAt ?? null, 'iso') ?? createdAt;
      await storage.entity({
        type: TRACE_ENTITY,
        id: trace.id,
        attributes: {
          name: trace.name ?? null,
          projectId: trace.projectId ?? null,
          userId: trace.userId ?? null,
          sessionId: trace.sessionId ?? null,
          release: trace.release ?? null,
          version: trace.version ?? null,
          totalCost: finiteNumberOrNull(trace.totalCost),
          latencyMs: finiteNumberOrNull(trace.latency),
          createdAt: trace.createdAt ?? null,
        },
        updated_at: updatedAt,
      });
    }
  }

  private async fetchDailyMetricsPage(
    options: SyncOptions,
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: DailyMetricRecord[]; next: string | null }> {
    const pageNum = parsePage(page);
    const url = new URL(`${this.baseUrl}/api/public/metrics/daily`);
    url.searchParams.set('page', String(pageNum));
    url.searchParams.set('limit', String(METRICS_PAGE_SIZE));
    const start = this.windowStart(options);
    url.searchParams.set('fromTimestamp', start.toISOString());
    const res = await this.get<DailyMetricsResponse>(url.toString(), {
      resource: 'observations_per_day',
      headers: this.buildHeaders(),
      signal,
    });
    const data = res.body.data;
    const totalPages = res.body.meta?.totalPages ?? 0;
    const next =
      data.length > 0 && pageNum < totalPages ? String(pageNum + 1) : null;
    return { items: data, next };
  }

  private async writeDailyMetrics(
    storage: StorageHandle,
    items: DailyMetricRecord[],
  ): Promise<void> {
    for (const row of items) {
      const ts = dateStringToMs(row.date);
      if (ts === null) {
        continue;
      }
      const usage = row.usage ?? [];
      if (usage.length === 0) {
        const count = finiteNumber(row.countObservations);
        await storage.metric(
          metricSample(langfuseResources, OBSERVATIONS_METRIC, {
            ts,
            value: count,
            attributes: {
              model: null,
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              costUsd: finiteNumber(row.totalCost),
            },
          }),
        );
        continue;
      }
      for (const entry of usage) {
        const count = finiteNumber(entry.countObservations);
        const input = finiteNumber(entry.inputUsage);
        const output = finiteNumber(entry.outputUsage);
        const totalTokens =
          entry.totalUsage !== null && entry.totalUsage !== undefined
            ? finiteNumber(entry.totalUsage)
            : input + output;
        await storage.metric(
          metricSample(langfuseResources, OBSERVATIONS_METRIC, {
            ts,
            value: count,
            attributes: {
              model: entry.model ?? null,
              inputTokens: input,
              outputTokens: output,
              totalTokens,
              costUsd: finiteNumber(entry.totalCost),
            },
          }),
        );
      }
    }
  }

  private async fetchScoresPage(
    options: SyncOptions,
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: ScoreRecord[]; next: string | null }> {
    const pageNum = parsePage(page);
    const url = new URL(`${this.baseUrl}/api/public/scores`);
    url.searchParams.set('page', String(pageNum));
    url.searchParams.set('limit', String(SCORES_PAGE_SIZE));
    const start = this.windowStart(options);
    url.searchParams.set('fromTimestamp', start.toISOString());
    const res = await this.get<ScoresListResponse>(url.toString(), {
      resource: 'scores',
      headers: this.buildHeaders(),
      signal,
    });
    const data = res.body.data;
    const sinceMs = options.since ? new Date(options.since).getTime() : null;
    const allBeforeSince =
      sinceMs !== null &&
      data.length > 0 &&
      data.every((s) => {
        const ts =
          parseEpoch(s.timestamp ?? null, 'iso') ??
          parseEpoch(s.createdAt ?? null, 'iso');
        return ts !== null && ts < sinceMs;
      });
    const totalPages = res.body.meta?.totalPages ?? 0;
    const next =
      !allBeforeSince && data.length > 0 && pageNum < totalPages
        ? String(pageNum + 1)
        : null;
    return { items: data, next };
  }

  private collectScores(
    acc: Map<string, ScoreAcc>,
    items: ScoreRecord[],
  ): void {
    for (const score of items) {
      const ts =
        parseEpoch(score.timestamp ?? null, 'iso') ??
        parseEpoch(score.createdAt ?? null, 'iso');
      if (ts === null) {
        continue;
      }
      const day = startOfUtcDay(ts);
      const key = `${day}|${score.name}`;
      const prev = acc.get(key) ?? { count: 0, sum: 0, numericCount: 0 };
      prev.count += 1;
      if (typeof score.value === 'number' && Number.isFinite(score.value)) {
        prev.sum += score.value;
        prev.numericCount += 1;
      }
      acc.set(key, prev);
    }
  }

  private async flushScores(
    storage: StorageHandle,
    acc: Map<string, ScoreAcc>,
  ): Promise<void> {
    for (const [key, scoreAcc] of acc) {
      const sep = key.indexOf('|');
      const dayMs = Number(key.slice(0, sep));
      const name = key.slice(sep + 1);
      const average =
        scoreAcc.numericCount > 0 ? scoreAcc.sum / scoreAcc.numericCount : 0;
      await storage.metric(
        metricSample(langfuseResources, SCORES_METRIC, {
          ts: dayMs,
          value: average,
          attributes: {
            scoreName: name,
            count: scoreAcc.count,
          },
        }),
      );
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: LangfusePhase,
    isFull: boolean,
    windowStartMs: number,
  ): Promise<void> {
    switch (phase) {
      case 'traces':
        if (isFull) {
          await storage.entities([], { types: [TRACE_ENTITY] });
        }
        return;
      case 'observations_per_day': {
        if (isFull) {
          await storage.metrics([], { names: [OBSERVATIONS_METRIC] });
        } else {
          const existing = await storage.queryMetrics({
            name: OBSERVATIONS_METRIC,
          });
          const toKeep = existing.filter((m) => m.ts < windowStartMs);
          await storage.metrics(toKeep, { names: [OBSERVATIONS_METRIC] });
        }
        return;
      }
      case 'scores': {
        if (isFull) {
          await storage.metrics([], { names: [SCORES_METRIC] });
        } else {
          const existing = await storage.queryMetrics({ name: SCORES_METRIC });
          const toKeep = existing.filter((m) => m.ts < windowStartMs);
          await storage.metrics(toKeep, { names: [SCORES_METRIC] });
        }
        return;
      }
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: Exclude<LangfusePhase, 'scores'>,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'traces':
        await this.writeTraces(storage, items as TraceRecord[]);
        return;
      case 'observations_per_day':
        await this.writeDailyMetrics(storage, items as DailyMetricRecord[]);
        return;
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isLangfuseSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const windowStartMs = this.windowStart(options).getTime();
    const scoresAcc = new Map<string, ScoreAcc>();

    const phases = selectActivePhases<LangfuseResource, LangfusePhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    const result = await paginateChunked<LangfusePhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      maxChunkMs: CHUNK_BUDGET_MS,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'traces':
            return this.fetchTracesPage(options, page, sig);
          case 'observations_per_day':
            return this.fetchDailyMetricsPage(options, page, sig);
          case 'scores':
            return this.fetchScoresPage(options, page, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(
            storage,
            phase,
            isFull,
            windowStartMs,
          );
        }
        if (phase === 'scores') {
          this.collectScores(scoresAcc, items as ScoreRecord[]);
        } else {
          await this.writePhase(storage, phase, items);
        }
      },
    });

    await this.flushScores(storage, scoresAcc);
    return result;
  }
}

function parsePage(page: string | null): number {
  if (page === null) {
    return 1;
  }
  const n = Number(page);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function finiteNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) {
    return fallback;
  }
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

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

function encodeBasicAuth(raw: string): string {
  if (typeof btoa === 'function') {
    return btoa(raw);
  }
  const bufferCtor = (
    globalThis as {
      Buffer?: { from: (s: string) => { toString: (enc: string) => string } };
    }
  ).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(raw).toString('base64');
  }
  throw new Error('No base64 encoder available in this runtime');
}
