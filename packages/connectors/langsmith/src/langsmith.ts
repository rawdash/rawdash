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
    apiKey: z.object({ $secret: z.string() }).meta({
      label: 'API key',
      description:
        'LangSmith API key with read access to the tenant. Create one in LangSmith -> Settings -> API Keys.',
      placeholder: 'lsv2_pt_...',
      secret: true,
    }),
    endpoint: z
      .string()
      .trim()
      .regex(
        /^https?:\/\/[^\s/]+$/,
        'Use a base URL with protocol and no trailing slash, e.g. https://api.smith.langchain.com',
      )
      .default('https://api.smith.langchain.com')
      .meta({
        label: 'Endpoint',
        description:
          'LangSmith API base URL. Defaults to https://api.smith.langchain.com (US cloud). Use https://eu.api.smith.langchain.com for the EU region or your self-hosted origin. No trailing slash.',
        placeholder: 'https://api.smith.langchain.com',
      }),
    lookbackDays: z.number().int().positive().max(365).optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many calendar days of history to backfill on a full sync. Defaults to 30.',
      placeholder: '30',
    }),
    resources: z
      .array(z.enum(['runs', 'runs_per_day', 'feedback']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which LangSmith resources to sync. Omit to sync all of them. Both `runs` and `runs_per_day` are produced from the same upstream query, so listing either pulls runs.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'LangSmith',
  category: 'engineering',
  brandColor: '#7FC8FF',
  tagline:
    'Sync LangChain runs, daily run rollups (count, tokens, cost, latency), and feedback scores from a LangSmith tenant.',
  vendor: {
    name: 'LangSmith',
    domain: 'langchain.com',
    apiDocs: 'https://docs.smith.langchain.com/reference',
    website: 'https://smith.langchain.com',
  },
  auth: {
    summary:
      'A LangSmith API key with read access is required. The key is sent as the `x-api-key` header on every request.',
    setup: [
      'Open LangSmith -> Settings -> API Keys and create a Personal Access Token (or Service key) with read access.',
      'Copy the key (it is shown once).',
      'Set `endpoint` to your LangSmith region: https://api.smith.langchain.com (US, default), https://eu.api.smith.langchain.com (EU), or your self-hosted origin (no trailing slash).',
      'Store the API key as a secret and reference it from config as `apiKey: secret("LANGSMITH_API_KEY")`.',
    ],
  },
  rateLimit:
    'LangSmith applies per-tenant rate limits and returns 429 with Retry-After on overrun; the shared HTTP client honors that header.',
  limitations: [
    'Run input/output payloads are not synced - only the run envelope plus aggregated cost, token, and latency.',
    'Datasets, examples, prompts, and evaluation runs are out of scope for the initial release.',
    'Feedback non-numeric values (string, boolean, JSON) are still counted but do not contribute to the score sample.',
  ],
});

export interface LangSmithSettings {
  endpoint: string;
  lookbackDays?: number;
  resources?: readonly LangSmithResource[];
}

const langsmithCredentials = {
  apiKey: {
    description: 'LangSmith API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type LangSmithCredentials = typeof langsmithCredentials;

export type LangSmithResource = 'runs' | 'runs_per_day' | 'feedback';

const PHASE_ORDER = ['runs', 'feedback'] as const;

type LangSmithPhase = (typeof PHASE_ORDER)[number];

const isLangSmithSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const RUNS_PAGE_SIZE = 100;
const FEEDBACK_PAGE_SIZE = 100;
const CHUNK_BUDGET_MS = 25_000;
const DEFAULT_LOOKBACK_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RUN_ENTITY = 'langsmith_run';
const RUNS_PER_DAY_METRIC = 'langsmith_runs_per_day';
const FEEDBACK_METRIC = 'langsmith_feedback';

interface RunRecord {
  id: string;
  name?: string | null;
  run_type?: string | null;
  status?: string | null;
  session_id?: string | null;
  session_name?: string | null;
  parent_run_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  error?: string | null;
  total_tokens?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_cost?: number | null;
  prompt_cost?: number | null;
  completion_cost?: number | null;
  latency?: number | null;
}

interface RunsQueryResponse {
  runs: RunRecord[];
  cursors?: { next?: string | null } | null;
}

interface FeedbackRecord {
  id: string;
  run_id?: string | null;
  session_id?: string | null;
  key: string;
  score?: number | null;
  value?: unknown;
  comment?: string | null;
  source_info?: Record<string, unknown> | null;
  created_at?: string | null;
  modified_at?: string | null;
}

const runSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  run_type: z.string().nullish(),
  status: z.string().nullish(),
  session_id: z.string().nullish(),
  session_name: z.string().nullish(),
  parent_run_id: z.string().nullish(),
  start_time: z.string().nullish(),
  end_time: z.string().nullish(),
  error: z.string().nullish(),
  total_tokens: z.number().nullish(),
  prompt_tokens: z.number().nullish(),
  completion_tokens: z.number().nullish(),
  total_cost: z.number().nullish(),
  prompt_cost: z.number().nullish(),
  completion_cost: z.number().nullish(),
  latency: z.number().nullish(),
});

const runsQueryResponseSchema = z.object({
  runs: z.array(runSchema),
  cursors: z
    .object({
      next: z.string().nullish(),
    })
    .nullish(),
});

const feedbackSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().nullish(),
  session_id: z.string().nullish(),
  key: z.string().min(1),
  score: z.number().nullish(),
  comment: z.string().nullish(),
  created_at: z.string().nullish(),
  modified_at: z.string().nullish(),
});

const feedbackListResponseSchema = z.array(feedbackSchema);

export const langsmithResources = defineResources({
  langsmith_run: {
    shape: 'entity',
    filterable: [
      {
        field: 'sessionId',
        ops: ['eq'],
      },
      {
        field: 'runType',
        ops: ['eq'],
        values: ['chain', 'tool', 'llm', 'embedding', 'parser', 'retriever'],
      },
      {
        field: 'status',
        ops: ['eq'],
        values: ['success', 'error', 'pending'],
      },
    ],
    description:
      'LangSmith run rows, keyed by id, with name, owning session/project, parent run, run type, status, start/end timestamps, total/prompt/completion tokens, total/prompt/completion cost in USD, and end-to-end latency in milliseconds.',
    endpoint: 'POST /api/v1/runs/query',
    notes:
      'Runs upsert by id on every run. Trace input/output payloads are not stored.',
    fields: [
      { name: 'name', description: 'Run name set by the SDK.' },
      {
        name: 'runType',
        description:
          'Run type (chain, tool, llm, embedding, parser, retriever).',
      },
      {
        name: 'status',
        description: 'Run status (success, error, pending).',
      },
      {
        name: 'sessionId',
        description: 'Owning session (project) id, if any.',
      },
      {
        name: 'sessionName',
        description: 'Owning session (project) name, if any.',
      },
      {
        name: 'parentRunId',
        description: 'Parent run id for nested runs.',
      },
      {
        name: 'startTime',
        description: 'ISO timestamp of run start.',
      },
      {
        name: 'endTime',
        description: 'ISO timestamp of run end, if completed.',
      },
      {
        name: 'totalTokens',
        description: 'Aggregate token count across the run.',
      },
      {
        name: 'promptTokens',
        description: 'Prompt token count for the run.',
      },
      {
        name: 'completionTokens',
        description: 'Completion token count for the run.',
      },
      {
        name: 'totalCost',
        description: 'Aggregate run cost in USD.',
      },
      {
        name: 'latencyMs',
        description: 'End-to-end latency in milliseconds.',
      },
      {
        name: 'error',
        description: 'Error message if the run failed.',
      },
    ],
    responses: { runs: runsQueryResponseSchema },
  },
  langsmith_runs_per_day: {
    shape: 'metric',
    description:
      'Per-run samples used to roll runs up to daily totals at query time. One sample is emitted per run at its start timestamp, tagged with project, run type, and status. The sample value is 1 (so summing field:`value` yields the run count); token, cost, and latency are exposed as additional measures.',
    endpoint: 'POST /api/v1/runs/query',
    unit: 'runs',
    granularity: 'Per-run (query-time rollup)',
    notes:
      'No server-side aggregation - widgets group by day, project, or run type to produce the rollup.',
    dimensions: [
      {
        name: 'sessionId',
        description: 'Owning session (project) id, if any.',
      },
      {
        name: 'sessionName',
        description: 'Owning session (project) name, if any.',
      },
      {
        name: 'runType',
        description: 'Run type (chain, tool, llm, embedding, ...).',
      },
      {
        name: 'status',
        description: 'Run status (success, error, pending).',
      },
    ],
    measures: [
      {
        name: 'totalTokens',
        description: 'Total tokens consumed by the run.',
      },
      {
        name: 'promptTokens',
        description: 'Prompt tokens consumed by the run.',
      },
      {
        name: 'completionTokens',
        description: 'Completion tokens produced by the run.',
      },
      {
        name: 'costUsd',
        description: 'Aggregate run cost in USD.',
      },
      {
        name: 'latencyMs',
        description: 'End-to-end run latency in milliseconds.',
      },
    ],
    responses: {},
  },
  langsmith_feedback: {
    shape: 'metric',
    description:
      'Feedback rows from LangSmith, one sample per feedback row at its created_at timestamp. The sample value is the numeric score (zero for non-numeric feedback) and the measure `count` is 1 so summing it yields feedback counts per (day, project, key).',
    endpoint: 'GET /api/v1/feedback',
    unit: 'score',
    granularity: 'Per-feedback (query-time rollup)',
    notes:
      'Non-numeric feedback (string, boolean, JSON value) is still emitted but with score 0; use `count` to count rows and average `score` for numeric trends.',
    dimensions: [
      {
        name: 'key',
        description: 'Feedback key as set by the SDK or annotator.',
      },
      {
        name: 'sessionId',
        description: 'Owning session (project) id, if known.',
      },
      {
        name: 'runId',
        description: 'Run the feedback is attached to, if any.',
      },
    ],
    measures: [
      {
        name: 'count',
        description: 'One per feedback row; sum to count rows.',
      },
      {
        name: 'hasNumericScore',
        description:
          '1 if the feedback row had a numeric score, 0 otherwise; sum these to compute strict numeric counts.',
      },
    ],
    responses: { feedback: feedbackListResponseSchema },
  },
});

export const id = 'langsmith';

export class LangSmithConnector extends BaseConnector<
  LangSmithSettings,
  LangSmithCredentials
> {
  static readonly id = id;

  static readonly resources = langsmithResources;

  static readonly schemas = schemasFromResources(langsmithResources);

  static create(input: unknown, ctx?: ConnectorContext): LangSmithConnector {
    const parsed = configFields.parse(input);
    return new LangSmithConnector(
      {
        endpoint: parsed.endpoint,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = langsmithCredentials;

  private get baseUrl(): string {
    return this.settings.endpoint.replace(/\/+$/, '');
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      'x-api-key': this.creds.apiKey,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('langsmith'),
      ...(extra ?? {}),
    };
  }

  private windowStartIso(options: SyncOptions): string {
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const now = Date.now();
    let startMs = now - lookbackDays * MS_PER_DAY;
    if (options.since) {
      const sinceMs = new Date(options.since).getTime();
      if (Number.isFinite(sinceMs) && sinceMs > startMs) {
        startMs = sinceMs;
      }
    }
    return new Date(startMs).toISOString();
  }

  private wantsRunEntity(): boolean {
    return resourceIsActive(this.settings.resources, 'runs');
  }

  private wantsRunsPerDay(): boolean {
    return resourceIsActive(this.settings.resources, 'runs_per_day');
  }

  private wantsFeedback(): boolean {
    return resourceIsActive(this.settings.resources, 'feedback');
  }

  private async fetchRunsPage(
    options: SyncOptions,
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: RunRecord[]; next: string | null }> {
    const offset = parseOffset(page);
    const body = {
      start_time: this.windowStartIso(options),
      limit: RUNS_PAGE_SIZE,
      offset,
      order: 'asc',
    };
    const res = await this.post<RunsQueryResponse>(
      `${this.baseUrl}/api/v1/runs/query`,
      {
        resource: 'runs',
        headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal,
      },
    );
    const runs = res.body.runs ?? [];
    const sinceMs = options.since ? new Date(options.since).getTime() : null;
    const allBeforeSince =
      sinceMs !== null &&
      runs.length > 0 &&
      runs.every((r) => {
        const ts = parseEpoch(r.start_time ?? null, 'iso');
        return ts !== null && ts < sinceMs;
      });
    const explicitNext = res.body.cursors?.next ?? null;
    let next: string | null;
    if (allBeforeSince) {
      next = null;
    } else if (explicitNext) {
      next = explicitNext;
    } else if (runs.length === RUNS_PAGE_SIZE) {
      next = String(offset + runs.length);
    } else {
      next = null;
    }
    return { items: runs, next };
  }

  private async writeRunsBatch(
    storage: StorageHandle,
    runs: RunRecord[],
  ): Promise<void> {
    const wantEntity = this.wantsRunEntity();
    const wantMetric = this.wantsRunsPerDay();
    if (!wantEntity && !wantMetric) {
      return;
    }
    for (const run of runs) {
      const startMs = parseEpoch(run.start_time ?? null, 'iso');
      const endMs = parseEpoch(run.end_time ?? null, 'iso');
      const latencyMs = computeLatencyMs(run, startMs, endMs);
      if (wantEntity) {
        const updatedAt = endMs ?? startMs ?? 0;
        await storage.entity({
          type: RUN_ENTITY,
          id: run.id,
          attributes: {
            name: run.name ?? null,
            runType: run.run_type ?? null,
            status: run.status ?? null,
            sessionId: run.session_id ?? null,
            sessionName: run.session_name ?? null,
            parentRunId: run.parent_run_id ?? null,
            startTime: run.start_time ?? null,
            endTime: run.end_time ?? null,
            totalTokens: finiteNumberOrNull(run.total_tokens),
            promptTokens: finiteNumberOrNull(run.prompt_tokens),
            completionTokens: finiteNumberOrNull(run.completion_tokens),
            totalCost: finiteNumberOrNull(run.total_cost),
            promptCost: finiteNumberOrNull(run.prompt_cost),
            completionCost: finiteNumberOrNull(run.completion_cost),
            latencyMs,
            error: run.error ?? null,
          },
          updated_at: updatedAt,
        });
      }
      if (wantMetric && startMs !== null) {
        await storage.metric(
          metricSample(langsmithResources, RUNS_PER_DAY_METRIC, {
            ts: startMs,
            value: 1,
            attributes: {
              sessionId: run.session_id ?? null,
              sessionName: run.session_name ?? null,
              runType: run.run_type ?? null,
              status: run.status ?? null,
              totalTokens: finiteNumber(run.total_tokens),
              promptTokens: finiteNumber(run.prompt_tokens),
              completionTokens: finiteNumber(run.completion_tokens),
              costUsd: finiteNumber(run.total_cost),
              latencyMs: latencyMs ?? 0,
            },
          }),
        );
      }
    }
  }

  private async fetchFeedbackPage(
    options: SyncOptions,
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: FeedbackRecord[]; next: string | null }> {
    const offset = parseOffset(page);
    const url = new URL(`${this.baseUrl}/api/v1/feedback`);
    url.searchParams.set('limit', String(FEEDBACK_PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('start_time', this.windowStartIso(options));
    const res = await this.get<FeedbackRecord[]>(url.toString(), {
      resource: 'feedback',
      headers: this.buildHeaders(),
      signal,
    });
    const rows = Array.isArray(res.body) ? res.body : [];
    const sinceMs = options.since ? new Date(options.since).getTime() : null;
    const allBeforeSince =
      sinceMs !== null &&
      rows.length > 0 &&
      rows.every((f) => {
        const ts = parseEpoch(f.created_at ?? null, 'iso');
        return ts !== null && ts < sinceMs;
      });
    const next =
      !allBeforeSince && rows.length === FEEDBACK_PAGE_SIZE
        ? String(offset + rows.length)
        : null;
    return { items: rows, next };
  }

  private async writeFeedbackBatch(
    storage: StorageHandle,
    rows: FeedbackRecord[],
  ): Promise<void> {
    for (const row of rows) {
      const ts = parseEpoch(row.created_at ?? null, 'iso');
      if (ts === null) {
        continue;
      }
      const numeric =
        typeof row.score === 'number' && Number.isFinite(row.score);
      const score = numeric ? (row.score as number) : 0;
      await storage.metric(
        metricSample(langsmithResources, FEEDBACK_METRIC, {
          ts,
          value: score,
          attributes: {
            key: row.key,
            sessionId: row.session_id ?? null,
            runId: row.run_id ?? null,
            count: 1,
            hasNumericScore: numeric ? 1 : 0,
          },
        }),
      );
    }
  }

  private activePhases(): LangSmithPhase[] {
    return selectActivePhases<LangSmithResource, LangSmithPhase>(
      (r) => {
        switch (r) {
          case 'runs':
          case 'runs_per_day':
            return 'runs';
          case 'feedback':
            return 'feedback';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: LangSmithPhase,
    isFull: boolean,
  ): Promise<void> {
    switch (phase) {
      case 'runs':
        if (isFull && this.wantsRunEntity()) {
          await storage.entities([], { types: [RUN_ENTITY] });
        }
        if (isFull && this.wantsRunsPerDay()) {
          await storage.metrics([], { names: [RUNS_PER_DAY_METRIC] });
        }
        return;
      case 'feedback':
        if (isFull) {
          await storage.metrics([], { names: [FEEDBACK_METRIC] });
        }
        return;
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isLangSmithSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const phases = this.activePhases();

    return paginateChunked<LangSmithPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      maxChunkMs: CHUNK_BUDGET_MS,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'runs':
            return this.fetchRunsPage(options, page, sig);
          case 'feedback':
            return this.fetchFeedbackPage(options, page, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        switch (phase) {
          case 'runs':
            await this.writeRunsBatch(storage, items as RunRecord[]);
            return;
          case 'feedback':
            if (this.wantsFeedback()) {
              await this.writeFeedbackBatch(storage, items as FeedbackRecord[]);
            }
            return;
        }
      },
    });
  }
}

function parseOffset(page: string | null): number {
  if (page === null) {
    return 0;
  }
  const n = Number(page);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
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

function computeLatencyMs(
  run: RunRecord,
  startMs: number | null,
  endMs: number | null,
): number | null {
  if (typeof run.latency === 'number' && Number.isFinite(run.latency)) {
    return run.latency;
  }
  if (startMs !== null && endMs !== null && endMs >= startMs) {
    return endMs - startMs;
  }
  return null;
}

function resourceIsActive(
  allowlist: readonly LangSmithResource[] | undefined,
  resource: LangSmithResource,
): boolean {
  if (!allowlist || allowlist.length === 0) {
    return true;
  }
  return allowlist.includes(resource);
}
