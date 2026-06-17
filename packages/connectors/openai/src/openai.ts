import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
  standardRateLimitPolicy,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
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
  makeChunkedCursorGuard,
  metricSample,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

const OPENAI_API_HOST = 'api.openai.com';
const OPENAI_API_BASE = `https://${OPENAI_API_HOST}`;
const PAGE_LIMIT = 31;
const MS_PER_DAY = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 30;
const INCREMENTAL_LOOKBACK_DAYS = 2;

export const configFields = defineConfigFields(
  z.object({
    adminApiKey: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Admin API key',
      description:
        'OpenAI organization admin API key (starts with sk-admin-). Generate one at platform.openai.com -> Settings -> Admin keys. Project / user-scoped keys cannot read the Usage API.',
      placeholder: 'OPENAI_ADMIN_API_KEY',
      secret: true,
    }),
    organizationId: z.string().min(1).optional().meta({
      label: 'Organization ID (optional)',
      description:
        'OpenAI organization id (org_...). Set this when the admin key has access to multiple organizations to disambiguate the request.',
      placeholder: 'org_abc123',
    }),
    projectIds: z.array(z.string().min(1)).nonempty().optional().meta({
      label: 'Project IDs (optional)',
      description:
        'Restrict usage and cost queries to specific OpenAI project ids (proj_...). Omit to aggregate every project the admin key can see.',
    }),
    resources: z
      .array(
        z.enum([
          'openai_completions_input_tokens',
          'openai_completions_output_tokens',
          'openai_completions_requests',
          'openai_embeddings_input_tokens',
          'openai_embeddings_requests',
          'openai_images_count',
          'openai_images_requests',
          'openai_audio_speeches_characters',
          'openai_audio_speeches_requests',
          'openai_audio_transcriptions_seconds',
          'openai_audio_transcriptions_requests',
          'openai_cost_usd',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which OpenAI metric series to sync. Omit to sync all of them. Resources are grouped by upstream endpoint - enabling any one metric from a group fetches the endpoint once and writes every metric the group produces.',
      }),
    lookbackDays: z.number().int().positive().max(180).optional().meta({
      label: 'Backfill window (days)',
      description:
        'How many days of usage history to fetch on a full sync. Defaults to 30. Capped at 180 since the Usage API rejects very long ranges per call.',
      placeholder: '30',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'OpenAI',
  category: 'engineering',
  brandColor: '#10A37F',
  tagline:
    'Track OpenAI spend, daily token usage, request counts, and image / audio volume from the OpenAI Usage and Costs admin APIs.',
  vendor: {
    name: 'OpenAI',
    domain: 'openai.com',
    apiDocs: 'https://platform.openai.com/docs/api-reference/usage',
    website: 'https://openai.com',
  },
  auth: {
    summary:
      'Authenticates with an OpenAI organization admin API key (sk-admin-). Admin keys are the only key class that can read the Usage and Costs endpoints; project- or user-scoped keys return 401.',
    setup: [
      'Open platform.openai.com -> Settings -> Admin keys and create a new admin key. Admin keys are organization-scoped, so create the key from the organization whose usage you want to read.',
      'Store the key as a secret (e.g. OPENAI_ADMIN_API_KEY).',
      'Reference it from config as `adminApiKey: secret("OPENAI_ADMIN_API_KEY")`.',
      'If the key has access to multiple organizations, set `organizationId` to disambiguate. Set `projectIds` to restrict the query to a subset of projects.',
    ],
  },
  rateLimit:
    'The Usage and Costs admin endpoints share an organization-wide rate limit; the connector backs off on standard x-ratelimit-* / 429 responses with Retry-After.',
  limitations: [
    'Only the Usage API (token, image, audio counts) and Costs API are synced. Per-request logs (Chat Completions, Embeddings, Images traffic) are not available through the admin Usage API.',
    'All samples are bucketed daily (1d bucket_width). Hourly granularity is supported by the Usage API but is not exposed here in v1.',
    'The Costs API only supports 1d bucket_width and reports cost in USD; non-USD billing currencies are not converted.',
    'Admin API keys are required - project- or user-scoped keys do not have access to the organization Usage and Costs endpoints.',
  ],
});

const openaiRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-ratelimit-remaining-requests',
  resetHeader: 'x-ratelimit-reset-requests',
  resetUnit: 's',
});

const PHASE_ORDER = [
  'usage_completions',
  'usage_embeddings',
  'usage_images',
  'usage_audio_speeches',
  'usage_audio_transcriptions',
  'costs',
] as const;

type OpenAIPhase = (typeof PHASE_ORDER)[number];

export type OpenAIResource =
  | 'openai_completions_input_tokens'
  | 'openai_completions_output_tokens'
  | 'openai_completions_requests'
  | 'openai_embeddings_input_tokens'
  | 'openai_embeddings_requests'
  | 'openai_images_count'
  | 'openai_images_requests'
  | 'openai_audio_speeches_characters'
  | 'openai_audio_speeches_requests'
  | 'openai_audio_transcriptions_seconds'
  | 'openai_audio_transcriptions_requests'
  | 'openai_cost_usd';

const isOpenAISyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const RESOURCES_BY_PHASE: Record<OpenAIPhase, readonly OpenAIResource[]> = {
  usage_completions: [
    'openai_completions_input_tokens',
    'openai_completions_output_tokens',
    'openai_completions_requests',
  ],
  usage_embeddings: [
    'openai_embeddings_input_tokens',
    'openai_embeddings_requests',
  ],
  usage_images: ['openai_images_count', 'openai_images_requests'],
  usage_audio_speeches: [
    'openai_audio_speeches_characters',
    'openai_audio_speeches_requests',
  ],
  usage_audio_transcriptions: [
    'openai_audio_transcriptions_seconds',
    'openai_audio_transcriptions_requests',
  ],
  costs: ['openai_cost_usd'],
};

const PHASE_ENDPOINT_PATH: Record<OpenAIPhase, string> = {
  usage_completions: '/v1/organization/usage/completions',
  usage_embeddings: '/v1/organization/usage/embeddings',
  usage_images: '/v1/organization/usage/images',
  usage_audio_speeches: '/v1/organization/usage/audio_speeches',
  usage_audio_transcriptions: '/v1/organization/usage/audio_transcriptions',
  costs: '/v1/organization/costs',
};

const completionsResultSchema = z.object({
  object: z.literal('organization.usage.completions.result'),
  input_tokens: z.number().nonnegative(),
  input_cached_tokens: z.number().nonnegative().nullish(),
  output_tokens: z.number().nonnegative(),
  input_audio_tokens: z.number().nonnegative().nullish(),
  output_audio_tokens: z.number().nonnegative().nullish(),
  num_model_requests: z.number().int().nonnegative(),
  project_id: z.string().nullish(),
  user_id: z.string().nullish(),
  api_key_id: z.string().nullish(),
  model: z.string().nullish(),
  batch: z.boolean().nullish(),
});

const embeddingsResultSchema = z.object({
  object: z.literal('organization.usage.embeddings.result'),
  input_tokens: z.number().nonnegative(),
  num_model_requests: z.number().int().nonnegative(),
  project_id: z.string().nullish(),
  user_id: z.string().nullish(),
  api_key_id: z.string().nullish(),
  model: z.string().nullish(),
});

const imagesResultSchema = z.object({
  object: z.literal('organization.usage.images.result'),
  images: z.number().int().nonnegative(),
  num_model_requests: z.number().int().nonnegative(),
  source: z.string().nullish(),
  size: z.string().nullish(),
  project_id: z.string().nullish(),
  user_id: z.string().nullish(),
  api_key_id: z.string().nullish(),
  model: z.string().nullish(),
});

const audioSpeechesResultSchema = z.object({
  object: z.literal('organization.usage.audio_speeches.result'),
  characters: z.number().nonnegative(),
  num_model_requests: z.number().int().nonnegative(),
  project_id: z.string().nullish(),
  user_id: z.string().nullish(),
  api_key_id: z.string().nullish(),
  model: z.string().nullish(),
});

const audioTranscriptionsResultSchema = z.object({
  object: z.literal('organization.usage.audio_transcriptions.result'),
  seconds: z.number().nonnegative(),
  num_model_requests: z.number().int().nonnegative(),
  project_id: z.string().nullish(),
  user_id: z.string().nullish(),
  api_key_id: z.string().nullish(),
  model: z.string().nullish(),
});

const costsResultSchema = z.object({
  object: z.literal('organization.costs.result'),
  amount: z.object({
    value: z.number(),
    currency: z.string(),
  }),
  line_item: z.string().nullish(),
  project_id: z.string().nullish(),
  organization_id: z.string().nullish(),
});

function bucketResponseSchema<T extends z.ZodTypeAny>(resultSchema: T) {
  return z.object({
    object: z.literal('page'),
    data: z.array(
      z.object({
        object: z.literal('bucket'),
        start_time: z.number().int().nonnegative(),
        end_time: z.number().int().nonnegative(),
        results: z.array(resultSchema),
      }),
    ),
    has_more: z.boolean(),
    next_page: z.string().nullish(),
  });
}

const completionsResponseSchema = bucketResponseSchema(completionsResultSchema);
const embeddingsResponseSchema = bucketResponseSchema(embeddingsResultSchema);
const imagesResponseSchema = bucketResponseSchema(imagesResultSchema);
const audioSpeechesResponseSchema = bucketResponseSchema(
  audioSpeechesResultSchema,
);
const audioTranscriptionsResponseSchema = bucketResponseSchema(
  audioTranscriptionsResultSchema,
);
const costsResponseSchema = bucketResponseSchema(costsResultSchema);

type CompletionsResult = z.infer<typeof completionsResultSchema>;
type EmbeddingsResult = z.infer<typeof embeddingsResultSchema>;
type ImagesResult = z.infer<typeof imagesResultSchema>;
type AudioSpeechesResult = z.infer<typeof audioSpeechesResultSchema>;
type AudioTranscriptionsResult = z.infer<
  typeof audioTranscriptionsResultSchema
>;
type CostsResult = z.infer<typeof costsResultSchema>;

interface BucketPage<TResult> {
  start_time: number;
  end_time: number;
  results: TResult[];
}

interface PageResponse<TResult> {
  buckets: BucketPage<TResult>[];
  nextPage: string | null;
}

const USAGE_DIMENSIONS_TOKENS = [
  { name: 'model', description: 'Model id reported by OpenAI (or null).' },
  {
    name: 'project_id',
    description: 'OpenAI project id the usage is attributed to (or null).',
  },
  {
    name: 'api_key_id',
    description: 'API key id the usage is attributed to (or null).',
  },
  {
    name: 'user_id',
    description: 'OpenAI user id the usage is attributed to (or null).',
  },
  {
    name: 'batch',
    description:
      'Whether the bucket represents Batch API traffic. Present only on completions usage.',
  },
] as const;

const USAGE_DIMENSIONS_BASIC = [
  { name: 'model', description: 'Model id reported by OpenAI (or null).' },
  {
    name: 'project_id',
    description: 'OpenAI project id the usage is attributed to (or null).',
  },
  {
    name: 'api_key_id',
    description: 'API key id the usage is attributed to (or null).',
  },
  {
    name: 'user_id',
    description: 'OpenAI user id the usage is attributed to (or null).',
  },
] as const;

const IMAGE_DIMENSIONS = [
  ...USAGE_DIMENSIONS_BASIC,
  {
    name: 'source',
    description:
      'OpenAI image-source category (image-generation, image-edit, etc.).',
  },
  {
    name: 'size',
    description: 'Image size requested (e.g. 1024x1024).',
  },
] as const;

export const openaiResources = defineResources({
  openai_completions_input_tokens: {
    shape: 'metric',
    description:
      'Daily input tokens consumed by Chat Completions and Responses API calls, including cached and audio input tokens.',
    endpoint: 'GET /v1/organization/usage/completions',
    unit: 'tokens',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS_TOKENS],
    measures: [
      {
        name: 'input_cached_tokens',
        description:
          'Cached input tokens included in the bucket total, for computing a cache-hit ratio (cached / total) at query time.',
      },
      {
        name: 'input_audio_tokens',
        description: 'Audio input tokens included in the bucket total.',
      },
    ],
    notes:
      'Sample value is the total input_tokens for the bucket. input_cached_tokens and input_audio_tokens are secondary measures so a cache-hit ratio (cached / total) can be computed at query time.',
    responses: { usage_completions: completionsResponseSchema },
  },
  openai_completions_output_tokens: {
    shape: 'metric',
    description:
      'Daily output tokens generated by Chat Completions and Responses API calls, including audio output tokens.',
    endpoint: 'GET /v1/organization/usage/completions',
    unit: 'tokens',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS_TOKENS],
    measures: [
      {
        name: 'output_audio_tokens',
        description:
          'Audio output tokens included in the bucket total, for audio-only breakdowns.',
      },
    ],
    notes:
      'Sample value is the total output_tokens for the bucket. output_audio_tokens is a secondary measure for audio-only breakdowns. Written alongside openai_completions_input_tokens from the same usage_completions API call.',
  },
  openai_completions_requests: {
    shape: 'metric',
    description:
      'Daily count of Chat Completions / Responses API model requests, grouped by model and project.',
    endpoint: 'GET /v1/organization/usage/completions',
    unit: 'requests',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS_TOKENS],
    notes:
      'Written alongside openai_completions_input_tokens from the same usage_completions API call.',
  },
  openai_embeddings_input_tokens: {
    shape: 'metric',
    description:
      'Daily input tokens consumed by the Embeddings API, grouped by model and project.',
    endpoint: 'GET /v1/organization/usage/embeddings',
    unit: 'tokens',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS_BASIC],
    responses: { usage_embeddings: embeddingsResponseSchema },
  },
  openai_embeddings_requests: {
    shape: 'metric',
    description:
      'Daily count of Embeddings API model requests, grouped by model and project.',
    endpoint: 'GET /v1/organization/usage/embeddings',
    unit: 'requests',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS_BASIC],
    notes:
      'Written alongside openai_embeddings_input_tokens from the same usage_embeddings API call.',
  },
  openai_images_count: {
    shape: 'metric',
    description:
      'Daily count of images generated or edited via the Images API, grouped by model, project, source, and size.',
    endpoint: 'GET /v1/organization/usage/images',
    unit: 'images',
    granularity: 'daily',
    dimensions: [...IMAGE_DIMENSIONS],
    responses: { usage_images: imagesResponseSchema },
  },
  openai_images_requests: {
    shape: 'metric',
    description:
      'Daily count of Images API model requests, grouped by model, project, source, and size.',
    endpoint: 'GET /v1/organization/usage/images',
    unit: 'requests',
    granularity: 'daily',
    dimensions: [...IMAGE_DIMENSIONS],
    notes:
      'Written alongside openai_images_count from the same usage_images API call.',
  },
  openai_audio_speeches_characters: {
    shape: 'metric',
    description:
      'Daily characters synthesized via the Text-to-Speech (audio_speeches) API, grouped by model and project.',
    endpoint: 'GET /v1/organization/usage/audio_speeches',
    unit: 'characters',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS_BASIC],
    responses: { usage_audio_speeches: audioSpeechesResponseSchema },
  },
  openai_audio_speeches_requests: {
    shape: 'metric',
    description:
      'Daily count of Text-to-Speech (audio_speeches) API model requests, grouped by model and project.',
    endpoint: 'GET /v1/organization/usage/audio_speeches',
    unit: 'requests',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS_BASIC],
    notes:
      'Written alongside openai_audio_speeches_characters from the same usage_audio_speeches API call.',
  },
  openai_audio_transcriptions_seconds: {
    shape: 'metric',
    description:
      'Daily audio seconds transcribed via the Whisper / audio_transcriptions API, grouped by model and project.',
    endpoint: 'GET /v1/organization/usage/audio_transcriptions',
    unit: 'seconds',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS_BASIC],
    responses: {
      usage_audio_transcriptions: audioTranscriptionsResponseSchema,
    },
  },
  openai_audio_transcriptions_requests: {
    shape: 'metric',
    description:
      'Daily count of audio_transcriptions API model requests, grouped by model and project.',
    endpoint: 'GET /v1/organization/usage/audio_transcriptions',
    unit: 'requests',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS_BASIC],
    notes:
      'Written alongside openai_audio_transcriptions_seconds from the same usage_audio_transcriptions API call.',
  },
  openai_cost_usd: {
    shape: 'metric',
    description:
      'Daily organization spend in USD, broken down by line item and project. Pulled from the OpenAI Costs admin API.',
    endpoint: 'GET /v1/organization/costs',
    unit: 'USD',
    granularity: 'daily',
    notes:
      'The Costs API only supports 1d bucket_width and only reports USD amounts. Costs can be revised for a couple of days after the fact; incremental syncs refetch a short trailing window to pick up adjustments.',
    dimensions: [
      {
        name: 'line_item',
        description:
          'OpenAI cost line item label (e.g. "Mar 2026 - Chat Completions"), or null when ungrouped.',
      },
      {
        name: 'project_id',
        description: 'OpenAI project id the cost is attributed to (or null).',
      },
      {
        name: 'organization_id',
        description:
          'OpenAI organization id the cost is attributed to (or null).',
      },
      {
        name: 'currency',
        description: 'Billing currency reported by OpenAI (typically usd).',
      },
    ],
    responses: { costs: costsResponseSchema },
  },
});

export interface OpenAISettings {
  organizationId?: string;
  projectIds?: readonly string[];
  resources?: readonly OpenAIResource[];
  lookbackDays?: number;
}

const openaiCredentials = {
  adminApiKey: {
    description: 'OpenAI organization admin API key (sk-admin-...)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type OpenAICredentials = typeof openaiCredentials;

export const id = 'openai';

interface UsageWindow {
  startTimeSeconds: number;
  endTimeSeconds: number;
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
    startTimeSeconds: Math.floor(startMs / 1000),
    endTimeSeconds: Math.floor(endMs / 1000),
  };
}

function resourceToPhase(resource: OpenAIResource): OpenAIPhase {
  for (const phase of PHASE_ORDER) {
    if ((RESOURCES_BY_PHASE[phase] as readonly string[]).includes(resource)) {
      return phase;
    }
  }
  // unreachable - the union of RESOURCES_BY_PHASE covers OpenAIResource
  throw new Error(`openai: unmapped resource ${resource}`);
}

function nullableString(value: string | null | undefined): string | null {
  return value === undefined || value === null ? null : value;
}

function nullableBoolean(value: boolean | null | undefined): boolean | null {
  return value === undefined || value === null ? null : value;
}

function tokensCommonAttributes(
  row: CompletionsResult,
): Record<string, JSONValue> {
  return {
    model: nullableString(row.model),
    project_id: nullableString(row.project_id),
    api_key_id: nullableString(row.api_key_id),
    user_id: nullableString(row.user_id),
    batch: nullableBoolean(row.batch),
  };
}

function embeddingsCommonAttributes(
  row: EmbeddingsResult,
): Record<string, JSONValue> {
  return {
    model: nullableString(row.model),
    project_id: nullableString(row.project_id),
    api_key_id: nullableString(row.api_key_id),
    user_id: nullableString(row.user_id),
  };
}

function imagesCommonAttributes(row: ImagesResult): Record<string, JSONValue> {
  return {
    model: nullableString(row.model),
    project_id: nullableString(row.project_id),
    api_key_id: nullableString(row.api_key_id),
    user_id: nullableString(row.user_id),
    source: nullableString(row.source),
    size: nullableString(row.size),
  };
}

function audioCommonAttributes(
  row: AudioSpeechesResult | AudioTranscriptionsResult,
): Record<string, JSONValue> {
  return {
    model: nullableString(row.model),
    project_id: nullableString(row.project_id),
    api_key_id: nullableString(row.api_key_id),
    user_id: nullableString(row.user_id),
  };
}

export function buildCompletionsSamples(
  buckets: readonly BucketPage<CompletionsResult>[],
): {
  inputTokens: MetricSample[];
  outputTokens: MetricSample[];
  requests: MetricSample[];
} {
  const inputTokens: MetricSample[] = [];
  const outputTokens: MetricSample[] = [];
  const requests: MetricSample[] = [];
  for (const bucket of buckets) {
    const ts = bucket.start_time * 1000;
    for (const row of bucket.results) {
      const common = tokensCommonAttributes(row);
      inputTokens.push(
        metricSample(openaiResources, 'openai_completions_input_tokens', {
          ts,
          value: row.input_tokens,
          attributes: {
            ...common,
            input_cached_tokens: row.input_cached_tokens ?? 0,
            input_audio_tokens: row.input_audio_tokens ?? 0,
          },
        }),
      );
      outputTokens.push(
        metricSample(openaiResources, 'openai_completions_output_tokens', {
          ts,
          value: row.output_tokens,
          attributes: {
            ...common,
            output_audio_tokens: row.output_audio_tokens ?? 0,
          },
        }),
      );
      requests.push(
        metricSample(openaiResources, 'openai_completions_requests', {
          ts,
          value: row.num_model_requests,
          attributes: { ...common },
        }),
      );
    }
  }
  return { inputTokens, outputTokens, requests };
}

export function buildEmbeddingsSamples(
  buckets: readonly BucketPage<EmbeddingsResult>[],
): { inputTokens: MetricSample[]; requests: MetricSample[] } {
  const inputTokens: MetricSample[] = [];
  const requests: MetricSample[] = [];
  for (const bucket of buckets) {
    const ts = bucket.start_time * 1000;
    for (const row of bucket.results) {
      const common = embeddingsCommonAttributes(row);
      inputTokens.push(
        metricSample(openaiResources, 'openai_embeddings_input_tokens', {
          ts,
          value: row.input_tokens,
          attributes: { ...common },
        }),
      );
      requests.push(
        metricSample(openaiResources, 'openai_embeddings_requests', {
          ts,
          value: row.num_model_requests,
          attributes: { ...common },
        }),
      );
    }
  }
  return { inputTokens, requests };
}

export function buildImagesSamples(
  buckets: readonly BucketPage<ImagesResult>[],
): { count: MetricSample[]; requests: MetricSample[] } {
  const count: MetricSample[] = [];
  const requests: MetricSample[] = [];
  for (const bucket of buckets) {
    const ts = bucket.start_time * 1000;
    for (const row of bucket.results) {
      const common = imagesCommonAttributes(row);
      count.push(
        metricSample(openaiResources, 'openai_images_count', {
          ts,
          value: row.images,
          attributes: { ...common },
        }),
      );
      requests.push(
        metricSample(openaiResources, 'openai_images_requests', {
          ts,
          value: row.num_model_requests,
          attributes: { ...common },
        }),
      );
    }
  }
  return { count, requests };
}

export function buildAudioSpeechesSamples(
  buckets: readonly BucketPage<AudioSpeechesResult>[],
): { characters: MetricSample[]; requests: MetricSample[] } {
  const characters: MetricSample[] = [];
  const requests: MetricSample[] = [];
  for (const bucket of buckets) {
    const ts = bucket.start_time * 1000;
    for (const row of bucket.results) {
      const common = audioCommonAttributes(row);
      characters.push(
        metricSample(openaiResources, 'openai_audio_speeches_characters', {
          ts,
          value: row.characters,
          attributes: { ...common },
        }),
      );
      requests.push(
        metricSample(openaiResources, 'openai_audio_speeches_requests', {
          ts,
          value: row.num_model_requests,
          attributes: { ...common },
        }),
      );
    }
  }
  return { characters, requests };
}

export function buildAudioTranscriptionsSamples(
  buckets: readonly BucketPage<AudioTranscriptionsResult>[],
): { seconds: MetricSample[]; requests: MetricSample[] } {
  const seconds: MetricSample[] = [];
  const requests: MetricSample[] = [];
  for (const bucket of buckets) {
    const ts = bucket.start_time * 1000;
    for (const row of bucket.results) {
      const common = audioCommonAttributes(row);
      seconds.push(
        metricSample(openaiResources, 'openai_audio_transcriptions_seconds', {
          ts,
          value: row.seconds,
          attributes: { ...common },
        }),
      );
      requests.push(
        metricSample(openaiResources, 'openai_audio_transcriptions_requests', {
          ts,
          value: row.num_model_requests,
          attributes: { ...common },
        }),
      );
    }
  }
  return { seconds, requests };
}

export function buildCostSamples(
  buckets: readonly BucketPage<CostsResult>[],
): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const bucket of buckets) {
    const ts = bucket.start_time * 1000;
    for (const row of bucket.results) {
      samples.push(
        metricSample(openaiResources, 'openai_cost_usd', {
          ts,
          value: row.amount.value,
          attributes: {
            line_item: nullableString(row.line_item),
            project_id: nullableString(row.project_id),
            organization_id: nullableString(row.organization_id),
            currency: row.amount.currency,
          },
        }),
      );
    }
  }
  return samples;
}

export class OpenAIConnector extends BaseConnector<
  OpenAISettings,
  OpenAICredentials
> {
  static readonly id = id;

  static readonly resources = openaiResources;

  static readonly schemas = schemasFromResources(openaiResources);

  static create(input: unknown, ctx?: ConnectorContext): OpenAIConnector {
    const parsed = configFields.parse(input);
    return new OpenAIConnector(
      {
        organizationId: parsed.organizationId,
        projectIds: parsed.projectIds,
        resources: parsed.resources,
        lookbackDays: parsed.lookbackDays,
      },
      { adminApiKey: parsed.adminApiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = openaiCredentials;

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.creds.adminApiKey}`,
      'User-Agent': connectorUserAgent(this.id),
    };
    if (this.settings.organizationId) {
      headers['OpenAI-Organization'] = this.settings.organizationId;
    }
    return headers;
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
      rateLimit: openaiRateLimit,
    });
  }

  private buildInitialUrl(phase: OpenAIPhase, window: UsageWindow): string {
    const url = new URL(`${OPENAI_API_BASE}${PHASE_ENDPOINT_PATH[phase]}`);
    url.searchParams.set('start_time', String(window.startTimeSeconds));
    url.searchParams.set('end_time', String(window.endTimeSeconds));
    url.searchParams.set('bucket_width', '1d');
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (phase !== 'costs') {
      url.searchParams.append('group_by', 'model');
    }
    url.searchParams.append('group_by', 'project_id');
    if (phase === 'usage_completions' || phase === 'usage_embeddings') {
      url.searchParams.append('group_by', 'api_key_id');
      url.searchParams.append('group_by', 'user_id');
    }
    if (phase === 'costs') {
      url.searchParams.append('group_by', 'line_item');
    }
    for (const projectId of this.settings.projectIds ?? []) {
      url.searchParams.append('project_ids', projectId);
    }
    return url.toString();
  }

  private buildNextUrl(currentUrl: string, nextPage: string): string {
    const url = new URL(currentUrl);
    url.searchParams.set('page', nextPage);
    return url.toString();
  }

  private async fetchPhasePage<T>(
    phase: OpenAIPhase,
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
    const cursor = isOpenAISyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const window = getUsageWindow(options, lookbackDays);

    const phases = selectActivePhases<OpenAIResource, OpenAIPhase>(
      resourceToPhase,
      PHASE_ORDER,
      this.settings.resources,
    );

    const startIdx = cursor ? PHASE_ORDER.indexOf(cursor.phase) : 0;
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

      await this.writePhase(storage, phase, buckets);
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
    phase: OpenAIPhase,
    initialUrl: string,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{
    parsed: { data: BucketPage<unknown>[] };
    nextUrl: string | null;
  }> {
    switch (phase) {
      case 'usage_completions':
        return this.fetchPhasePage(
          phase,
          completionsResponseSchema,
          initialUrl,
          page,
          signal,
        );
      case 'usage_embeddings':
        return this.fetchPhasePage(
          phase,
          embeddingsResponseSchema,
          initialUrl,
          page,
          signal,
        );
      case 'usage_images':
        return this.fetchPhasePage(
          phase,
          imagesResponseSchema,
          initialUrl,
          page,
          signal,
        );
      case 'usage_audio_speeches':
        return this.fetchPhasePage(
          phase,
          audioSpeechesResponseSchema,
          initialUrl,
          page,
          signal,
        );
      case 'usage_audio_transcriptions':
        return this.fetchPhasePage(
          phase,
          audioTranscriptionsResponseSchema,
          initialUrl,
          page,
          signal,
        );
      case 'costs':
        return this.fetchPhasePage(
          phase,
          costsResponseSchema,
          initialUrl,
          page,
          signal,
        );
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: OpenAIPhase,
    buckets: BucketPage<unknown>[],
  ): Promise<void> {
    switch (phase) {
      case 'usage_completions': {
        const samples = buildCompletionsSamples(
          buckets as BucketPage<CompletionsResult>[],
        );
        await storage.metrics(samples.inputTokens, {
          names: ['openai_completions_input_tokens'],
        });
        await storage.metrics(samples.outputTokens, {
          names: ['openai_completions_output_tokens'],
        });
        await storage.metrics(samples.requests, {
          names: ['openai_completions_requests'],
        });
        return;
      }
      case 'usage_embeddings': {
        const samples = buildEmbeddingsSamples(
          buckets as BucketPage<EmbeddingsResult>[],
        );
        await storage.metrics(samples.inputTokens, {
          names: ['openai_embeddings_input_tokens'],
        });
        await storage.metrics(samples.requests, {
          names: ['openai_embeddings_requests'],
        });
        return;
      }
      case 'usage_images': {
        const samples = buildImagesSamples(
          buckets as BucketPage<ImagesResult>[],
        );
        await storage.metrics(samples.count, {
          names: ['openai_images_count'],
        });
        await storage.metrics(samples.requests, {
          names: ['openai_images_requests'],
        });
        return;
      }
      case 'usage_audio_speeches': {
        const samples = buildAudioSpeechesSamples(
          buckets as BucketPage<AudioSpeechesResult>[],
        );
        await storage.metrics(samples.characters, {
          names: ['openai_audio_speeches_characters'],
        });
        await storage.metrics(samples.requests, {
          names: ['openai_audio_speeches_requests'],
        });
        return;
      }
      case 'usage_audio_transcriptions': {
        const samples = buildAudioTranscriptionsSamples(
          buckets as BucketPage<AudioTranscriptionsResult>[],
        );
        await storage.metrics(samples.seconds, {
          names: ['openai_audio_transcriptions_seconds'],
        });
        await storage.metrics(samples.requests, {
          names: ['openai_audio_transcriptions_requests'],
        });
        return;
      }
      case 'costs': {
        const samples = buildCostSamples(buckets as BucketPage<CostsResult>[]);
        await storage.metrics(samples, { names: ['openai_cost_usd'] });
        return;
      }
    }
  }
}

export type {
  PageResponse,
  BucketPage,
  CompletionsResult,
  EmbeddingsResult,
  ImagesResult,
  AudioSpeechesResult,
  AudioTranscriptionsResult,
  CostsResult,
};
