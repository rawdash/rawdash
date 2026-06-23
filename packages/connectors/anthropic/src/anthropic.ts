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
  type MetricSample,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  makeChunkedCursorGuard,
  metricSample,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

const ANTHROPIC_API_HOST = 'api.anthropic.com';
const ANTHROPIC_API_BASE = `https://${ANTHROPIC_API_HOST}`;
const ANTHROPIC_API_VERSION = '2023-06-01';
const USAGE_PAGE_LIMIT = 31;
const COSTS_PAGE_LIMIT = 31;
const MS_PER_DAY = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 30;
const INCREMENTAL_LOOKBACK_DAYS = 2;
// Cost report `amount` is a decimal string in the lowest currency unit (cents
// for USD): e.g. "123.45" represents $1.2345. Divide by 100 to get dollars.
const COST_AMOUNT_DIVISOR = 100;

export const configFields = defineConfigFields(
  z.object({
    adminApiKey: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Admin API key',
      description:
        'Anthropic organization admin API key (starts with sk-ant-admin-). Create one at console.anthropic.com -> Settings -> Admin keys. Regular API keys (sk-ant-api-) cannot read the Usage and Cost reports.',
      placeholder: 'ANTHROPIC_ADMIN_API_KEY',
      secret: true,
    }),
    workspaceIds: z.array(z.string().min(1)).nonempty().optional().meta({
      label: 'Workspace IDs (optional)',
      description:
        'Restrict usage and cost queries to specific Anthropic workspace ids (wrkspc_...). Omit to aggregate every workspace the admin key can see.',
    }),
    resources: z
      .array(
        z.enum([
          'anthropic_input_tokens',
          'anthropic_output_tokens',
          'anthropic_cache_read_tokens',
          'anthropic_cache_creation_tokens',
          'anthropic_web_search_requests',
          'anthropic_cost_usd',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Anthropic metric series to sync. Omit to sync all of them. The five usage metrics share one upstream call to the Messages Usage Report; enabling any one of them fetches the report and writes all five.',
      }),
    lookbackDays: z.number().int().positive().max(180).optional().meta({
      label: 'Backfill window (days)',
      description:
        'How many days of usage history to fetch on a full sync. Defaults to 30. The Usage Report returns at most 31 buckets per page, so longer windows paginate.',
      placeholder: '30',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Anthropic',
  category: 'engineering',
  brandColor: '#D97757',
  tagline:
    'Track Anthropic spend, daily token usage across Claude models, cache hit volumes, and web-search tool requests from the Anthropic Admin API.',
  vendor: {
    name: 'Anthropic',
    domain: 'anthropic.com',
    apiDocs:
      'https://docs.claude.com/en/api/admin-api/usage-cost/get-messages-usage-report',
    website: 'https://anthropic.com',
  },
  auth: {
    summary:
      'Authenticates with an Anthropic organization admin API key (sk-ant-admin-). Admin keys are the only key class that can read the Usage and Cost reports; regular API keys return 403.',
    setup: [
      'Open console.anthropic.com -> Settings -> Admin Keys and create a new admin key. Admin keys are organization-scoped, so create the key from the organization whose usage you want to read.',
      'Store the key as a secret (e.g. ANTHROPIC_ADMIN_API_KEY).',
      'Reference it from config as `adminApiKey: secret("ANTHROPIC_ADMIN_API_KEY")`.',
      'Optionally set `workspaceIds` to restrict the query to a subset of workspaces.',
    ],
  },
  rateLimit:
    'The Admin API returns 429 with a Retry-After header on burst; the shared HTTP client honors it automatically. Daily syncs against the Usage and Cost reports are well below the per-organization Admin API budget.',
  limitations: [
    'Only the organization Messages Usage Report and Cost Report endpoints are synced. Per-request logs and individual message bodies are not exposed by the Admin API.',
    'All samples are bucketed daily (1d bucket_width). The Usage Report also supports hourly and per-minute granularity but those are not exposed here in v1.',
    'The Cost Report only supports 1d bucket_width and reports cost in USD; non-USD billing currencies are not converted.',
    'Admin API keys are required - regular sk-ant-api- keys do not have access to the organization Usage and Cost reports.',
  ],
});

const PHASE_ORDER = ['usage_messages', 'cost_report'] as const;

type AnthropicPhase = (typeof PHASE_ORDER)[number];

export type AnthropicResource =
  | 'anthropic_input_tokens'
  | 'anthropic_output_tokens'
  | 'anthropic_cache_read_tokens'
  | 'anthropic_cache_creation_tokens'
  | 'anthropic_web_search_requests'
  | 'anthropic_cost_usd';

const isAnthropicSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const RESOURCES_BY_PHASE: Record<AnthropicPhase, readonly AnthropicResource[]> =
  {
    usage_messages: [
      'anthropic_input_tokens',
      'anthropic_output_tokens',
      'anthropic_cache_read_tokens',
      'anthropic_cache_creation_tokens',
      'anthropic_web_search_requests',
    ],
    cost_report: ['anthropic_cost_usd'],
  };

const PHASE_ENDPOINT_PATH: Record<AnthropicPhase, string> = {
  usage_messages: '/v1/organizations/usage_report/messages',
  cost_report: '/v1/organizations/cost_report',
};

const usageCacheCreationSchema = z.object({
  ephemeral_1h_input_tokens: z.number().nonnegative().nullish(),
  ephemeral_5m_input_tokens: z.number().nonnegative().nullish(),
});

const usageServerToolUseSchema = z.object({
  web_search_requests: z.number().int().nonnegative().nullish(),
});

const usageResultSchema = z.object({
  account_id: z.string().nullish(),
  api_key_id: z.string().nullish(),
  cache_creation: usageCacheCreationSchema.nullish(),
  cache_read_input_tokens: z.number().nonnegative(),
  context_window: z.string().nullish(),
  inference_geo: z.string().nullish(),
  model: z.string().nullish(),
  output_tokens: z.number().nonnegative(),
  server_tool_use: usageServerToolUseSchema.nullish(),
  service_account_id: z.string().nullish(),
  service_tier: z.string().nullish(),
  uncached_input_tokens: z.number().nonnegative(),
  workspace_id: z.string().nullish(),
});

const costResultSchema = z.object({
  amount: z.string(),
  context_window: z.string().nullish(),
  cost_type: z.string().nullish(),
  currency: z.string(),
  description: z.string().nullish(),
  inference_geo: z.string().nullish(),
  model: z.string().nullish(),
  service_tier: z.string().nullish(),
  token_type: z.string().nullish(),
  workspace_id: z.string().nullish(),
});

function bucketResponseSchema<T extends z.ZodTypeAny>(resultSchema: T) {
  return z.object({
    data: z.array(
      z.object({
        starting_at: z.string(),
        ending_at: z.string(),
        results: z.array(resultSchema),
      }),
    ),
    has_more: z.boolean(),
    next_page: z.string().nullish(),
  });
}

const usageResponseSchema = bucketResponseSchema(usageResultSchema);
const costResponseSchema = bucketResponseSchema(costResultSchema);

type UsageResult = z.infer<typeof usageResultSchema>;
type CostResult = z.infer<typeof costResultSchema>;

interface BucketPage<TResult> {
  starting_at: string;
  ending_at: string;
  results: TResult[];
}

interface PageResponse<TResult> {
  buckets: BucketPage<TResult>[];
  nextPage: string | null;
}

const USAGE_DIMENSIONS = [
  {
    name: 'model',
    description: 'Claude model id reported by Anthropic (or null).',
  },
  {
    name: 'workspace_id',
    description:
      'Anthropic workspace id the usage is attributed to (or null for the default workspace).',
  },
  {
    name: 'api_key_id',
    description: 'API key id the usage is attributed to (or null).',
  },
  {
    name: 'service_tier',
    description:
      'Service tier the request ran under (standard, batch, priority, flex, etc.), or null.',
  },
  {
    name: 'context_window',
    description:
      'Context window bucket the request used (0-200k or 200k-1M), or null.',
  },
  {
    name: 'inference_geo',
    description:
      'Inference geo the request ran in (global, us, not_available), or null.',
  },
  {
    name: 'account_id',
    description: 'Account id the usage is attributed to (or null).',
  },
  {
    name: 'service_account_id',
    description: 'Service account id the usage is attributed to (or null).',
  },
] as const;

const COST_DIMENSIONS = [
  {
    name: 'workspace_id',
    description:
      'Anthropic workspace id the cost is attributed to (or null for the default workspace).',
  },
  {
    name: 'description',
    description:
      'Human-readable cost line item label (e.g. "Claude Sonnet 4 Usage - Input Tokens"), or null when ungrouped.',
  },
  {
    name: 'cost_type',
    description:
      'Cost category (tokens, web_search, code_execution, session_usage), or null.',
  },
  {
    name: 'model',
    description:
      'Claude model the cost is attributed to (or null for non-token costs).',
  },
  {
    name: 'token_type',
    description:
      'Token category for token costs (uncached_input_tokens, output_tokens, cache_read_input_tokens, cache_creation.ephemeral_*_input_tokens), or null.',
  },
  {
    name: 'service_tier',
    description:
      'Service tier the cost is attributed to (standard or batch), or null.',
  },
  {
    name: 'context_window',
    description:
      'Context window the cost is attributed to (0-200k or 200k-1M), or null.',
  },
  {
    name: 'currency',
    description:
      'Billing currency reported by Anthropic (currently always USD).',
  },
] as const;

export const anthropicResources = defineResources({
  anthropic_input_tokens: {
    shape: 'metric',
    description:
      'Daily uncached input tokens processed by the Anthropic Messages API, grouped by model and workspace.',
    endpoint: 'GET /v1/organizations/usage_report/messages',
    unit: 'tokens',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS],
    notes:
      'Sample value is uncached_input_tokens. Cache-read and cache-creation token volumes are mirrored on their own metrics so a cache hit ratio can be computed at query time.',
    responses: { usage_messages: usageResponseSchema },
  },
  anthropic_output_tokens: {
    shape: 'metric',
    description:
      'Daily output tokens generated by the Anthropic Messages API, grouped by model and workspace.',
    endpoint: 'GET /v1/organizations/usage_report/messages',
    unit: 'tokens',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS],
    notes:
      'Written alongside anthropic_input_tokens from the same usage_messages API call.',
  },
  anthropic_cache_read_tokens: {
    shape: 'metric',
    description:
      'Daily input tokens read from the prompt cache, grouped by model and workspace.',
    endpoint: 'GET /v1/organizations/usage_report/messages',
    unit: 'tokens',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS],
    notes:
      'Cache hits are charged at a fraction of the uncached rate, so this metric paired with anthropic_input_tokens gives the cache hit ratio.',
  },
  anthropic_cache_creation_tokens: {
    shape: 'metric',
    description:
      'Daily input tokens written into the prompt cache (sum of the 1h and 5m ephemeral caches), grouped by model and workspace.',
    endpoint: 'GET /v1/organizations/usage_report/messages',
    unit: 'tokens',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS],
    measures: [
      {
        name: 'ephemeral_1h_input_tokens',
        description:
          'Input tokens written into the 1-hour ephemeral prompt cache (a component of the sample value).',
      },
      {
        name: 'ephemeral_5m_input_tokens',
        description:
          'Input tokens written into the 5-minute ephemeral prompt cache (a component of the sample value).',
      },
    ],
    notes:
      'The per-cache-bucket counts (ephemeral_1h_input_tokens, ephemeral_5m_input_tokens) are declared measures for finer-grained widgets.',
  },
  anthropic_web_search_requests: {
    shape: 'metric',
    description:
      'Daily count of web-search tool requests executed server-side by Claude, grouped by model and workspace.',
    endpoint: 'GET /v1/organizations/usage_report/messages',
    unit: 'requests',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS],
    notes:
      'Sourced from server_tool_use.web_search_requests on each usage bucket. Zero rows are still written so a "no usage today" widget renders correctly.',
  },
  anthropic_cost_usd: {
    shape: 'metric',
    description:
      'Daily organization spend in USD, broken down by workspace and cost line item, pulled from the Anthropic Cost Report.',
    endpoint: 'GET /v1/organizations/cost_report',
    unit: 'USD',
    granularity: 'daily',
    dimensions: [...COST_DIMENSIONS],
    notes:
      'The Cost Report returns amounts as a decimal string in the lowest currency unit (cents for USD). The connector divides by 100 so the stored metric value is dollars. Costs can be revised for a couple of days after the fact; incremental syncs refetch a short trailing window to pick up adjustments.',
    responses: { cost_report: costResponseSchema },
  },
});

export interface AnthropicSettings {
  workspaceIds?: readonly string[];
  resources?: readonly AnthropicResource[];
  lookbackDays?: number;
}

const anthropicCredentials = {
  adminApiKey: {
    description: 'Anthropic organization admin API key (sk-ant-admin-...)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type AnthropicCredentials = typeof anthropicCredentials;

export const id = 'anthropic';

interface UsageWindow {
  startingAt: string;
  endingAt: string;
  startMs: number;
  endMs: number;
}

export function getUsageWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): UsageWindow {
  const todayStart = Math.floor(now / MS_PER_DAY) * MS_PER_DAY;
  const endMs = todayStart + MS_PER_DAY;

  let days = lookbackDays;
  if (options.mode === 'latest') {
    days = INCREMENTAL_LOOKBACK_DAYS;
  } else if (options.since !== undefined) {
    const sinceMs = parseEpoch(options.since, 'iso');
    if (sinceMs !== null) {
      const elapsed = Math.ceil((now - sinceMs) / MS_PER_DAY);
      days = Math.min(
        Math.max(elapsed + INCREMENTAL_LOOKBACK_DAYS, 1),
        lookbackDays,
      );
    }
  }
  const startMs = endMs - days * MS_PER_DAY;
  return {
    startingAt: new Date(startMs).toISOString(),
    endingAt: new Date(endMs).toISOString(),
    startMs,
    endMs,
  };
}

function resourceToPhase(resource: AnthropicResource): AnthropicPhase {
  for (const phase of PHASE_ORDER) {
    if ((RESOURCES_BY_PHASE[phase] as readonly string[]).includes(resource)) {
      return phase;
    }
  }
  // unreachable - RESOURCES_BY_PHASE covers every AnthropicResource
  throw new Error(`anthropic: unmapped resource ${resource}`);
}

function nullableString(value: string | null | undefined): string | null {
  return value === undefined || value === null ? null : value;
}

interface UsageDimensionAttributes {
  model: string | null;
  workspace_id: string | null;
  api_key_id: string | null;
  service_tier: string | null;
  context_window: string | null;
  inference_geo: string | null;
  account_id: string | null;
  service_account_id: string | null;
}

function usageDimensionAttributes(row: UsageResult): UsageDimensionAttributes {
  return {
    model: nullableString(row.model),
    workspace_id: nullableString(row.workspace_id),
    api_key_id: nullableString(row.api_key_id),
    service_tier: nullableString(row.service_tier),
    context_window: nullableString(row.context_window),
    inference_geo: nullableString(row.inference_geo),
    account_id: nullableString(row.account_id),
    service_account_id: nullableString(row.service_account_id),
  };
}

function cacheCreationTotal(row: UsageResult): number {
  const c = row.cache_creation;
  if (!c) {
    return 0;
  }
  return (
    (c.ephemeral_1h_input_tokens ?? 0) + (c.ephemeral_5m_input_tokens ?? 0)
  );
}

function tsFromBucket(bucket: BucketPage<unknown>): number | null {
  return parseEpoch(bucket.starting_at, 'iso');
}

export function buildUsageSamples(
  buckets: readonly BucketPage<UsageResult>[],
): {
  inputTokens: MetricSample[];
  outputTokens: MetricSample[];
  cacheReadTokens: MetricSample[];
  cacheCreationTokens: MetricSample[];
  webSearchRequests: MetricSample[];
} {
  const inputTokens: MetricSample[] = [];
  const outputTokens: MetricSample[] = [];
  const cacheReadTokens: MetricSample[] = [];
  const cacheCreationTokens: MetricSample[] = [];
  const webSearchRequests: MetricSample[] = [];
  for (const bucket of buckets) {
    const ts = tsFromBucket(bucket);
    if (ts === null) {
      continue;
    }
    for (const row of bucket.results) {
      const common = usageDimensionAttributes(row);
      const cacheCreation = row.cache_creation;
      inputTokens.push(
        metricSample(anthropicResources, 'anthropic_input_tokens', {
          ts,
          value: row.uncached_input_tokens,
          attributes: { ...common },
        }),
      );
      outputTokens.push(
        metricSample(anthropicResources, 'anthropic_output_tokens', {
          ts,
          value: row.output_tokens,
          attributes: { ...common },
        }),
      );
      cacheReadTokens.push(
        metricSample(anthropicResources, 'anthropic_cache_read_tokens', {
          ts,
          value: row.cache_read_input_tokens,
          attributes: { ...common },
        }),
      );
      cacheCreationTokens.push(
        metricSample(anthropicResources, 'anthropic_cache_creation_tokens', {
          ts,
          value: cacheCreationTotal(row),
          attributes: {
            ...common,
            ephemeral_1h_input_tokens:
              cacheCreation?.ephemeral_1h_input_tokens ?? 0,
            ephemeral_5m_input_tokens:
              cacheCreation?.ephemeral_5m_input_tokens ?? 0,
          },
        }),
      );
      webSearchRequests.push(
        metricSample(anthropicResources, 'anthropic_web_search_requests', {
          ts,
          value: row.server_tool_use?.web_search_requests ?? 0,
          attributes: { ...common },
        }),
      );
    }
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    webSearchRequests,
  };
}

export function buildCostSamples(
  buckets: readonly BucketPage<CostResult>[],
): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const bucket of buckets) {
    const ts = tsFromBucket(bucket);
    if (ts === null) {
      continue;
    }
    for (const row of bucket.results) {
      const rawAmount = Number.parseFloat(row.amount);
      const value = Number.isFinite(rawAmount)
        ? rawAmount / COST_AMOUNT_DIVISOR
        : 0;
      samples.push(
        metricSample(anthropicResources, 'anthropic_cost_usd', {
          ts,
          value,
          attributes: {
            workspace_id: nullableString(row.workspace_id),
            description: nullableString(row.description),
            cost_type: nullableString(row.cost_type),
            model: nullableString(row.model),
            token_type: nullableString(row.token_type),
            service_tier: nullableString(row.service_tier),
            context_window: nullableString(row.context_window),
            currency: row.currency,
          },
        }),
      );
    }
  }
  return samples;
}

export class AnthropicConnector extends BaseConnector<
  AnthropicSettings,
  AnthropicCredentials
> {
  static readonly id = id;

  static readonly resources = anthropicResources;

  static readonly schemas = schemasFromResources(anthropicResources);

  static create(input: unknown, ctx?: ConnectorContext): AnthropicConnector {
    const parsed = configFields.parse(input);
    return new AnthropicConnector(
      {
        workspaceIds: parsed.workspaceIds,
        resources: parsed.resources,
        lookbackDays: parsed.lookbackDays,
      },
      { adminApiKey: parsed.adminApiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = anthropicCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      'X-Api-Key': String(this.creds.adminApiKey),
      'anthropic-version': ANTHROPIC_API_VERSION,
      'User-Agent': connectorUserAgent(this.id),
    };
  }

  private fetch<T>(
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

  private buildInitialUrl(phase: AnthropicPhase, window: UsageWindow): string {
    const url = new URL(`${ANTHROPIC_API_BASE}${PHASE_ENDPOINT_PATH[phase]}`);
    url.searchParams.set('starting_at', window.startingAt);
    url.searchParams.set('ending_at', window.endingAt);
    url.searchParams.set('bucket_width', '1d');
    if (phase === 'usage_messages') {
      url.searchParams.set('limit', String(USAGE_PAGE_LIMIT));
      url.searchParams.append('group_by', 'model');
      url.searchParams.append('group_by', 'workspace_id');
      url.searchParams.append('group_by', 'api_key_id');
      url.searchParams.append('group_by', 'service_tier');
      url.searchParams.append('group_by', 'context_window');
      url.searchParams.append('group_by', 'inference_geo');
      for (const workspaceId of this.settings.workspaceIds ?? []) {
        url.searchParams.append('workspace_ids', workspaceId);
      }
    } else {
      url.searchParams.set('limit', String(COSTS_PAGE_LIMIT));
      url.searchParams.append('group_by', 'workspace_id');
      url.searchParams.append('group_by', 'description');
    }
    return url.toString();
  }

  private buildNextUrl(currentUrl: string, nextPage: string): string {
    const url = new URL(currentUrl);
    url.searchParams.set('page', nextPage);
    return url.toString();
  }

  private async fetchPhasePage<T>(
    phase: AnthropicPhase,
    schema: z.ZodType<T>,
    initialUrl: string,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ url: string; parsed: T; nextUrl: string | null }> {
    const url = page ?? initialUrl;
    const res = await this.fetch<unknown>(url, phase, signal);
    const parsed = schema.parse(res.body);
    const body = parsed as unknown as {
      next_page?: string | null;
      has_more?: boolean;
    };
    const nextPage =
      body.has_more === true &&
      typeof body.next_page === 'string' &&
      body.next_page.length > 0
        ? body.next_page
        : null;
    const nextUrl = nextPage ? this.buildNextUrl(url, nextPage) : null;
    return { url, parsed, nextUrl };
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isAnthropicSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const window = getUsageWindow(options, lookbackDays);

    const phases = selectActivePhases<AnthropicResource, AnthropicPhase>(
      resourceToPhase,
      PHASE_ORDER,
      this.settings.resources,
    );

    const startIdx = cursor ? phases.indexOf(cursor.phase) : 0;
    const resumeIdx = startIdx >= 0 ? startIdx : 0;

    for (let i = resumeIdx; i < phases.length; i++) {
      const phase = phases[i]!;
      if (signal?.aborted) {
        return { done: false, cursor: { phase, page: null } };
      }
      const phaseStart = Date.now();
      const initialUrl = this.buildInitialUrl(phase, window);
      let pageUrl: string | null = null;
      let pageCount = 0;
      const buckets: BucketPage<unknown>[] = [];

      while (true) {
        if (signal?.aborted) {
          return { done: false, cursor: { phase, page: null } };
        }
        pageCount += 1;
        const { parsed, nextUrl } = await this.fetchAnyPhasePage(
          phase,
          initialUrl,
          pageUrl,
          signal,
        );
        const data = parsed.data as BucketPage<unknown>[];
        buckets.push(...data);
        this.logger.info('fetched page', {
          resource: phase,
          page: pageCount,
          items: data.length,
        });
        if (nextUrl === null) {
          break;
        }
        pageUrl = nextUrl;
      }

      await this.writePhase(storage, phase, buckets, window);
      this.logger.info('resource done', {
        resource: phase,
        pages: pageCount,
        items: buckets.length,
        duration_ms: Date.now() - phaseStart,
      });
    }

    return { done: true };
  }

  private async fetchAnyPhasePage(
    phase: AnthropicPhase,
    initialUrl: string,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{
    parsed: { data: BucketPage<unknown>[] };
    nextUrl: string | null;
  }> {
    switch (phase) {
      case 'usage_messages':
        return this.fetchPhasePage(
          phase,
          usageResponseSchema,
          initialUrl,
          page,
          signal,
        );
      case 'cost_report':
        return this.fetchPhasePage(
          phase,
          costResponseSchema,
          initialUrl,
          page,
          signal,
        );
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: AnthropicPhase,
    buckets: BucketPage<unknown>[],
    window: UsageWindow,
  ): Promise<void> {
    const replaceWindow = { start: window.startMs, end: window.endMs };
    switch (phase) {
      case 'usage_messages': {
        const samples = buildUsageSamples(buckets as BucketPage<UsageResult>[]);
        await storage.metrics(samples.inputTokens, {
          names: ['anthropic_input_tokens'],
          replaceWindow,
        });
        await storage.metrics(samples.outputTokens, {
          names: ['anthropic_output_tokens'],
          replaceWindow,
        });
        await storage.metrics(samples.cacheReadTokens, {
          names: ['anthropic_cache_read_tokens'],
          replaceWindow,
        });
        await storage.metrics(samples.cacheCreationTokens, {
          names: ['anthropic_cache_creation_tokens'],
          replaceWindow,
        });
        await storage.metrics(samples.webSearchRequests, {
          names: ['anthropic_web_search_requests'],
          replaceWindow,
        });
        return;
      }
      case 'cost_report': {
        const samples = buildCostSamples(buckets as BucketPage<CostResult>[]);
        await storage.metrics(samples, {
          names: ['anthropic_cost_usd'],
          replaceWindow,
        });
        return;
      }
    }
  }
}

export type { PageResponse, BucketPage, UsageResult, CostResult };
