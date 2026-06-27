import {
  BaseAWSConnector,
  type BaseAWSSettings,
  awsAuthConfigShape,
  awsAuthRefine,
  createAuthorizationHeader,
  firstInner,
  firstText,
  formatAmzDate,
  parseGetMetricData,
  sha256Hex,
  topLevelMembers,
} from '@rawdash/connector-aws-shared';
import {
  AuthError,
  type HttpResponse,
  RateLimitError,
  TransientError,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  type ConnectorContext,
  type ConnectorCost,
  type ConnectorDoc,
  type ConnectorLogger,
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

export const configFields = defineConfigFields(
  z
    .object({
      ...awsAuthConfigShape,
      modelIds: z.array(z.string().min(1)).nonempty().optional().meta({
        label: 'Model IDs (optional)',
        description:
          'Restrict the sync to specific Bedrock model IDs (e.g. anthropic.claude-3-sonnet-20240229-v1:0). When omitted, the connector discovers active model IDs via CloudWatch ListMetrics on the AWS/Bedrock namespace.',
      }),
      lookbackDays: z.number().int().positive().max(365).optional().meta({
        label: 'Backfill window (days)',
        description:
          'How many days of history to fetch on a full sync. Defaults to 30.',
        placeholder: '30',
      }),
      granularitySeconds: z
        .number()
        .int()
        .min(60)
        .max(86_400)
        .refine((n) => n % 60 === 0, {
          message: 'granularitySeconds must be a multiple of 60',
        })
        .optional()
        .meta({
          label: 'CloudWatch period (seconds)',
          description:
            'Aggregation period for CloudWatch metric samples (multiple of 60). Defaults to 86400 (one day per sample).',
          placeholder: '86400',
        }),
    })
    .refine(awsAuthRefine.predicate, { message: awsAuthRefine.message }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'AWS Bedrock',
  category: 'engineering',
  brandColor: '#56C0A7',
  tagline:
    'Track Bedrock model invocations, input/output tokens, latency, errors, and spend per Bedrock-hosted model.',
  rateLimit:
    'CloudWatch GetMetricData batches up to 500 queries per call and follows NextToken pagination; Cost Explorer queries are billed at $0.01 each. Throttling (Throttling / ThrottlingException / TooManyRequests) is retried with backoff.',
  vendor: {
    name: 'Amazon Web Services',
    domain: 'aws.amazon.com',
    apiDocs:
      'https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-cw.html',
    website: 'https://aws.amazon.com/bedrock/',
  },
  auth: {
    summary:
      'Authenticate with either static IAM access keys or an assumed IAM role (STS). The principal needs cloudwatch:ListMetrics and cloudwatch:GetMetricData on the target region for invocation and error metrics, and ce:GetCostAndUsage on the Cost Explorer (us-east-1) endpoint for spend.',
    setup: [
      'Create an IAM user or role with a policy granting `cloudwatch:ListMetrics`, `cloudwatch:GetMetricData`, and `ce:GetCostAndUsage`.',
      'For static credentials, generate an access key ID and secret access key for that IAM user and store them as secrets.',
      'For role assumption, set `roleArn` to the role to assume (and `externalId` if its trust policy requires one); the base credentials must be allowed to `sts:AssumeRole` it.',
      'Set `region` to the AWS region where the Bedrock invocations are running, e.g. `us-east-1` or `us-west-2`. Cost Explorer is always reached through its global us-east-1 endpoint.',
      'Reference the keys from config, e.g. `accessKeyId: secret("AWS_ACCESS_KEY_ID")` and `secretAccessKey: secret("AWS_SECRET_ACCESS_KEY")`.',
    ],
  },
  limitations: [
    'CloudWatch metrics for Bedrock are only emitted for models that have been invoked; ListMetrics only returns models with activity in roughly the last 14 days.',
    'Cost Explorer does not expose a native modelId dimension; spend is grouped by USAGE_TYPE (e.g. inference input/output tokens per model), and the model identifier is embedded in the usage_type string.',
    'Each Cost Explorer query is billed $0.01; a full sync issues one GetCostAndUsage call (plus pagination).',
    'A full sync uses lookbackDays; a latest sync uses a trailing window covering the last few periods plus a short Cost Explorer overlap.',
    "The CloudWatch metric window is clamped to CloudWatch's period-based retention floor (period < 300s keeps 15 days, < 3600s keeps 63 days, otherwise 455 days), since GetMetricData returns no points older than the floor; shortening granularitySeconds below the lookback range truncates the window and the truncation is logged.",
  ],
});

export interface AwsBedrockSettings extends BaseAWSSettings {
  modelIds?: readonly string[];
  lookbackDays?: number;
  granularitySeconds?: number;
}

const BEDROCK_NAMESPACE = 'AWS/Bedrock';
const MODEL_DIMENSION = 'ModelId';

const CLOUDWATCH_SERVICE = 'monitoring';
const CLOUDWATCH_API_VERSION = '2010-08-01';
const MAX_QUERIES_PER_CALL = 500;
const MS_PER_DAY = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_GRANULARITY_SECONDS = 86_400;
const INCREMENTAL_LOOKBACK_DAYS = 3;

const RETENTION_FLOOR_HIGH_RES_MS = 15 * MS_PER_DAY;
const RETENTION_FLOOR_STANDARD_MS = 63 * MS_PER_DAY;
const RETENTION_FLOOR_LONG_TERM_MS = 455 * MS_PER_DAY;

function retentionFloorMs(periodSeconds: number): number {
  if (periodSeconds < 300) {
    return RETENTION_FLOOR_HIGH_RES_MS;
  }
  if (periodSeconds < 3600) {
    return RETENTION_FLOOR_STANDARD_MS;
  }
  return RETENTION_FLOOR_LONG_TERM_MS;
}

const CE_REGION = 'us-east-1';
const CE_HOST = 'ce.us-east-1.amazonaws.com';
const CE_URL = `https://${CE_HOST}/`;
const CE_SERVICE = 'ce';
const CE_CONTENT_TYPE = 'application/x-amz-json-1.1';
const CE_TARGET_PREFIX = 'AWSInsightsIndexService';
const BEDROCK_CE_SERVICE_NAME = 'Amazon Bedrock';

export const INVOCATIONS_METRIC = 'bedrock_invocations';
export const INPUT_TOKENS_METRIC = 'bedrock_input_tokens';
export const OUTPUT_TOKENS_METRIC = 'bedrock_output_tokens';
export const LATENCY_METRIC = 'bedrock_invocation_latency_ms';
export const ERRORS_METRIC = 'bedrock_errors';
export const SPEND_METRIC = 'bedrock_spend';

interface UsageMetricSpec {
  metricName: string;
  stat: 'Sum' | 'Average';
  outputName: string;
}

const USAGE_METRICS: readonly UsageMetricSpec[] = [
  { metricName: 'Invocations', stat: 'Sum', outputName: INVOCATIONS_METRIC },
  {
    metricName: 'InputTokenCount',
    stat: 'Sum',
    outputName: INPUT_TOKENS_METRIC,
  },
  {
    metricName: 'OutputTokenCount',
    stat: 'Sum',
    outputName: OUTPUT_TOKENS_METRIC,
  },
  {
    metricName: 'InvocationLatency',
    stat: 'Average',
    outputName: LATENCY_METRIC,
  },
];

interface ErrorMetricSpec {
  metricName: string;
  errorType: 'client' | 'server' | 'throttle';
}

const ERROR_METRICS: readonly ErrorMetricSpec[] = [
  { metricName: 'InvocationClientErrors', errorType: 'client' },
  { metricName: 'InvocationServerErrors', errorType: 'server' },
  { metricName: 'InvocationThrottles', errorType: 'throttle' },
];

const RESOURCE_BY_PHASE = {
  usage: [
    INVOCATIONS_METRIC,
    INPUT_TOKENS_METRIC,
    OUTPUT_TOKENS_METRIC,
    LATENCY_METRIC,
  ],
  errors: [ERRORS_METRIC],
  spend: [SPEND_METRIC],
} as const;

type Phase = keyof typeof RESOURCE_BY_PHASE;
const PHASE_ORDER: readonly Phase[] = ['usage', 'errors', 'spend'];

const listMetricsResponseSchema = z.object({
  ListMetricsResult: z.object({
    Metrics: z.array(
      z.object({
        Namespace: z.string(),
        MetricName: z.string(),
        Dimensions: z.array(z.object({ Name: z.string(), Value: z.string() })),
      }),
    ),
    NextToken: z.string().nullish(),
  }),
});

const metricDataResponseSchema = z.object({
  MetricDataResults: z.array(
    z.object({
      Id: z.string(),
      Label: z.string(),
      Timestamps: z.array(z.iso.datetime()),
      Values: z.array(z.number()),
      StatusCode: z.enum([
        'Complete',
        'InternalError',
        'PartialData',
        'Forbidden',
      ]),
    }),
  ),
  NextToken: z.string().optional(),
});

const ceAmountString = z.string().regex(/^-?\d+(\.\d+)?$/);
const ceDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ceMetricAmount = z.object({
  Amount: ceAmountString,
  Unit: z.string(),
});
const getCostAndUsageResponseSchema = z.object({
  ResultsByTime: z.array(
    z.object({
      TimePeriod: z.object({ Start: ceDateString, End: ceDateString }),
      Total: z.object({ UnblendedCost: ceMetricAmount.optional() }).optional(),
      Groups: z
        .array(
          z.object({
            Keys: z.array(z.string()),
            Metrics: z.object({ UnblendedCost: ceMetricAmount }),
          }),
        )
        .optional(),
      Estimated: z.boolean().optional(),
    }),
  ),
  NextPageToken: z.string().optional(),
});

export const awsBedrockResources = defineResources({
  [INVOCATIONS_METRIC]: {
    shape: 'metric',
    description:
      'Number of Bedrock model invocations per period and model. One sample per (timestamp, modelId).',
    endpoint: 'POST / (GetMetricData / AWS/Bedrock Invocations)',
    granularity: 'Configurable, defaults to daily (86400s)',
    notes:
      'Sourced from the CloudWatch AWS/Bedrock namespace, statistic Sum, grouped by the ModelId dimension.',
    dimensions: [
      {
        name: 'modelId',
        description:
          'Bedrock model identifier (e.g. anthropic.claude-3-sonnet-20240229-v1:0).',
      },
      {
        name: 'period',
        description: 'Aggregation period in seconds for the sample.',
      },
      {
        name: 'statusCode',
        description:
          'GetMetricData result status (Complete, PartialData, InternalError, or Forbidden).',
      },
    ],
    responses: {
      list_metrics: listMetricsResponseSchema,
      usage: metricDataResponseSchema,
    },
  },
  [INPUT_TOKENS_METRIC]: {
    shape: 'metric',
    description:
      'Bedrock input tokens billed per period and model (CloudWatch InputTokenCount, statistic Sum).',
    endpoint: 'POST / (GetMetricData / AWS/Bedrock InputTokenCount)',
    granularity: 'Configurable, defaults to daily (86400s)',
    dimensions: [
      {
        name: 'modelId',
        description:
          'Bedrock model identifier (e.g. anthropic.claude-3-sonnet-20240229-v1:0).',
      },
      {
        name: 'period',
        description: 'Aggregation period in seconds for the sample.',
      },
      {
        name: 'statusCode',
        description:
          'GetMetricData result status (Complete, PartialData, InternalError, or Forbidden).',
      },
    ],
  },
  [OUTPUT_TOKENS_METRIC]: {
    shape: 'metric',
    description:
      'Bedrock output tokens generated per period and model (CloudWatch OutputTokenCount, statistic Sum).',
    endpoint: 'POST / (GetMetricData / AWS/Bedrock OutputTokenCount)',
    granularity: 'Configurable, defaults to daily (86400s)',
    dimensions: [
      {
        name: 'modelId',
        description:
          'Bedrock model identifier (e.g. anthropic.claude-3-sonnet-20240229-v1:0).',
      },
      {
        name: 'period',
        description: 'Aggregation period in seconds for the sample.',
      },
      {
        name: 'statusCode',
        description:
          'GetMetricData result status (Complete, PartialData, InternalError, or Forbidden).',
      },
    ],
  },
  [LATENCY_METRIC]: {
    shape: 'metric',
    unit: 'milliseconds',
    description:
      'Average Bedrock invocation latency per period and model (CloudWatch InvocationLatency, statistic Average).',
    endpoint: 'POST / (GetMetricData / AWS/Bedrock InvocationLatency)',
    granularity: 'Configurable, defaults to daily (86400s)',
    dimensions: [
      {
        name: 'modelId',
        description:
          'Bedrock model identifier (e.g. anthropic.claude-3-sonnet-20240229-v1:0).',
      },
      {
        name: 'period',
        description: 'Aggregation period in seconds for the sample.',
      },
      {
        name: 'statusCode',
        description:
          'GetMetricData result status (Complete, PartialData, InternalError, or Forbidden).',
      },
    ],
  },
  [ERRORS_METRIC]: {
    shape: 'metric',
    description:
      'Bedrock invocation error count per period, model, and error type (CloudWatch InvocationClientErrors / InvocationServerErrors / InvocationThrottles, statistic Sum).',
    endpoint: 'POST / (GetMetricData / AWS/Bedrock Invocation*Errors)',
    granularity: 'Configurable, defaults to daily (86400s)',
    dimensions: [
      {
        name: 'modelId',
        description:
          'Bedrock model identifier (e.g. anthropic.claude-3-sonnet-20240229-v1:0).',
      },
      {
        name: 'errorType',
        description:
          'Class of error: client (4xx), server (5xx), or throttle (rate-limited).',
      },
      {
        name: 'period',
        description: 'Aggregation period in seconds for the sample.',
      },
    ],
    responses: { errors: metricDataResponseSchema },
  },
  [SPEND_METRIC]: {
    shape: 'metric',
    unit: 'USD',
    description:
      'Unblended AWS Bedrock spend per day, grouped by Cost Explorer USAGE_TYPE. Bedrock cost is split across input/output tokens and on-demand vs. provisioned throughput rather than by raw modelId.',
    endpoint:
      'POST GetCostAndUsage (Cost Explorer, filtered to Amazon Bedrock)',
    granularity: 'daily',
    notes:
      'Each Cost Explorer query is billed $0.01. Current-day spend is reported as estimated and is overwritten on later syncs as it finalizes.',
    dimensions: [
      {
        name: 'usageType',
        description:
          'Cost Explorer USAGE_TYPE string for the Bedrock usage line, e.g. USE1-Bedrock-OnDemand-InputTokens-anthropic.claude-3-sonnet.',
      },
      {
        name: 'estimated',
        description:
          'Whether the day is still estimated rather than finalized.',
      },
      { name: 'unit', description: 'Currency unit reported by AWS, e.g. USD.' },
    ],
    responses: { spend: getCostAndUsageResponseSchema },
  },
});

interface MetricDataParsedResult {
  id: string;
  label: string;
  statusCode: string;
  timestamps: string[];
  values: number[];
}

interface ListMetricsParsed {
  modelIds: string[];
  nextToken: string | null;
}

export function parseListMetrics(xml: string): ListMetricsParsed {
  const resultBlock = firstInner(xml, 'ListMetricsResult') ?? xml;
  const metricsBlock = firstInner(resultBlock, 'Metrics') ?? '';
  const ids = new Set<string>();
  for (const member of topLevelMembers(metricsBlock)) {
    const dimsBlock = firstInner(member, 'Dimensions') ?? '';
    for (const dimMember of topLevelMembers(dimsBlock)) {
      const name = firstText(dimMember, 'Name');
      const value = firstText(dimMember, 'Value');
      if (name === MODEL_DIMENSION && value !== null && value !== '') {
        ids.add(value);
      }
    }
  }
  const nextToken = firstText(resultBlock, 'NextToken');
  return {
    modelIds: [...ids],
    nextToken: nextToken === '' ? null : nextToken,
  };
}

interface CeMetricAmountLike {
  Amount?: string;
  Unit?: string;
}
interface CeResultByTime {
  TimePeriod?: { Start?: string; End?: string };
  Total?: Record<string, CeMetricAmountLike | undefined>;
  Groups?: Array<{
    Keys?: string[];
    Metrics?: Record<string, CeMetricAmountLike | undefined>;
  }>;
  Estimated?: boolean;
}
interface CeGetCostAndUsageBody {
  ResultsByTime?: CeResultByTime[];
  NextPageToken?: string;
}

function parseCeAmount(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function ceDateToMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) {
    return NaN;
  }
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

export function buildSpendSamples(body: CeGetCostAndUsageBody): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const result of body.ResultsByTime ?? []) {
    const start = result.TimePeriod?.Start;
    if (start === undefined) {
      continue;
    }
    const ts = ceDateToMs(start);
    if (!Number.isFinite(ts)) {
      continue;
    }
    const estimated = result.Estimated ?? false;
    const groups = result.Groups ?? [];
    if (groups.length > 0) {
      for (const group of groups) {
        const cost = group.Metrics?.['UnblendedCost'];
        const keys = group.Keys ?? [];
        samples.push({
          name: SPEND_METRIC,
          ts,
          value: parseCeAmount(cost?.Amount),
          attributes: {
            usageType: keys[0] ?? null,
            estimated,
            unit: cost?.Unit ?? 'USD',
          },
        });
      }
      continue;
    }
    const cost = result.Total?.['UnblendedCost'];
    if (!cost) {
      continue;
    }
    samples.push({
      name: SPEND_METRIC,
      ts,
      value: parseCeAmount(cost.Amount),
      attributes: { estimated, unit: cost.Unit ?? 'USD' },
    });
  }
  return samples;
}

export interface BedrockWindow {
  startMs: number;
  endMs: number;
}

export function getBedrockWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
  periodSeconds: number = DEFAULT_GRANULARITY_SECONDS,
  logger?: ConnectorLogger,
): BedrockWindow {
  const endMs = now;
  let requestedStartMs: number;
  const sinceMs =
    options.since !== undefined ? parseEpoch(options.since, 'iso') : null;
  if (sinceMs !== null) {
    requestedStartMs = Math.min(sinceMs, endMs);
  } else {
    const days =
      options.mode === 'latest' ? INCREMENTAL_LOOKBACK_DAYS : lookbackDays;
    requestedStartMs = endMs - days * MS_PER_DAY;
  }
  const floorMs = retentionFloorMs(periodSeconds);
  const earliestRetainedMs = endMs - floorMs;
  const startMs = Math.max(requestedStartMs, earliestRetainedMs);
  if (startMs > requestedStartMs) {
    logger?.warn('window truncated to retention floor', {
      retentionFloorMs: floorMs,
      requestedStartMs,
      effectiveStartMs: startMs,
      periodSeconds,
    });
  }
  return { startMs, endMs };
}

export interface SpendWindow {
  start: string;
  end: string;
}

export function getSpendWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): SpendWindow {
  const sinceMs =
    options.since !== undefined ? parseEpoch(options.since, 'iso') : null;
  const hasSince = sinceMs !== null;
  let days = lookbackDays;
  if (options.mode === 'latest') {
    days = INCREMENTAL_LOOKBACK_DAYS;
  } else if (hasSince) {
    const elapsed = Math.ceil((now - sinceMs) / MS_PER_DAY);
    days = Math.min(Math.max(elapsed, 1), lookbackDays);
  }
  const end = startOfUtcDay(now) + MS_PER_DAY;
  return { start: toDateStr(end - days * MS_PER_DAY), end: toDateStr(end) };
}

function bedrockReplaceWindow(
  window: BedrockWindow,
): { start: number; end: number } | null {
  if (window.endMs < window.startMs) {
    return null;
  }
  return { start: window.startMs, end: window.endMs };
}

function spendReplaceWindow(
  window: SpendWindow,
): { start: number; end: number } | null {
  const startMs = ceDateToMs(window.start);
  const endMs = ceDateToMs(window.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  const inclusiveEndMs = endMs - 1;
  if (inclusiveEndMs < startMs) {
    return null;
  }
  return { start: startMs, end: inclusiveEndMs };
}

interface HttpErrorLike {
  message: string;
  response?: HttpResponse;
}

function asHttpError(err: unknown): HttpErrorLike | null {
  if (
    err instanceof Error &&
    'kind' in err &&
    typeof (err as { kind?: unknown }).kind === 'string'
  ) {
    return err as unknown as HttpErrorLike;
  }
  return null;
}

function extractAwsJsonErrorType(err: HttpErrorLike): string {
  const body = err.response?.body;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as { __type?: string; Code?: string };
      return parsed.__type ?? parsed.Code ?? body;
    } catch {
      return body;
    }
  }
  if (body && typeof body === 'object') {
    const o = body as { __type?: unknown; Code?: unknown };
    return String(o.__type ?? o.Code ?? '');
  }
  return '';
}

function mapAwsJsonError(err: unknown): unknown {
  const httpError = asHttpError(err);
  if (!httpError) {
    return err;
  }
  const type = extractAwsJsonErrorType(httpError);
  const status = httpError.response?.status ?? 0;
  if (
    /throttl|TooManyRequests|RequestLimitExceeded|LimitExceeded/i.test(type) ||
    status === 429
  ) {
    return new RateLimitError(httpError.message, httpError.response);
  }
  if (
    /AccessDenied|UnrecognizedClient|InvalidClientTokenId|SignatureDoesNotMatch|AuthFailure|InvalidSignature|ExpiredToken/i.test(
      type,
    ) ||
    status === 403
  ) {
    return new AuthError(httpError.message, httpError.response);
  }
  if (status >= 500) {
    return new TransientError(httpError.message, httpError.response);
  }
  return err;
}

interface UsageQuery {
  queryId: string;
  modelId: string;
  spec: UsageMetricSpec;
}

interface ErrorQuery {
  queryId: string;
  modelId: string;
  spec: ErrorMetricSpec;
}

function isDataUnavailable(err: unknown): boolean {
  const httpError = asHttpError(err);
  return (
    httpError !== null &&
    /DataUnavailable/i.test(extractAwsJsonErrorType(httpError))
  );
}

export const id = 'aws-bedrock';

export const cost: ConnectorCost = {
  recommendedInterval: '1 day',
  minInterval: '1 hour',
  perSync: '1 Cost Explorer query (about $0.01) plus CloudWatch GetMetricData',
  warning:
    'Each AWS Cost Explorer query is billed $0.01, and CloudWatch GetMetricData is billed per metric requested. High-frequency syncs across many models add up.',
};

export class AwsBedrockConnector extends BaseAWSConnector<AwsBedrockSettings> {
  static readonly id = id;

  static readonly resources = awsBedrockResources;

  static readonly schemas = schemasFromResources(awsBedrockResources);

  static readonly cost = cost;

  static create(input: unknown, ctx?: ConnectorContext): AwsBedrockConnector {
    const parsed = configFields.parse(input);
    return new AwsBedrockConnector(
      {
        region: parsed.region,
        roleArn: parsed.roleArn,
        externalId: parsed.externalId,
        modelIds: parsed.modelIds,
        lookbackDays: parsed.lookbackDays,
        granularitySeconds: parsed.granularitySeconds,
      },
      {
        accessKeyId: parsed.accessKeyId,
        secretAccessKey: parsed.secretAccessKey,
      },
      ctx,
    );
  }

  readonly id = id;

  private resourceAllowed(options: SyncOptions, resourceName: string): boolean {
    if (!options.resources || options.resources.size === 0) {
      return true;
    }
    return options.resources.has(resourceName);
  }

  private phaseActive(options: SyncOptions, phase: Phase): boolean {
    return RESOURCE_BY_PHASE[phase].some((name) =>
      this.resourceAllowed(options, name),
    );
  }

  private async listModelIds(signal?: AbortSignal): Promise<string[]> {
    if (this.settings.modelIds && this.settings.modelIds.length > 0) {
      return [...this.settings.modelIds];
    }
    const host = `${CLOUDWATCH_SERVICE}.${this.settings.region}.amazonaws.com`;
    const ids = new Set<string>();
    let nextToken: string | undefined;
    let page = 0;
    do {
      if (signal?.aborted) {
        break;
      }
      const params = new URLSearchParams();
      params.set('Action', 'ListMetrics');
      params.set('Version', CLOUDWATCH_API_VERSION);
      params.set('Namespace', BEDROCK_NAMESPACE);
      params.set('MetricName', 'Invocations');
      if (nextToken !== undefined) {
        params.set('NextToken', nextToken);
      }
      const signingCredentials = await this.resolveSigningCredentials(signal);
      const xml = await this.signedPost({
        host,
        service: CLOUDWATCH_SERVICE,
        body: params.toString(),
        signingCredentials,
        resource: 'list_metrics',
        signal,
      });
      const parsed = parseListMetrics(xml);
      for (const id of parsed.modelIds) {
        ids.add(id);
      }
      nextToken = parsed.nextToken ?? undefined;
      page += 1;
      this.logger.info('fetched page', {
        resource: 'list_metrics',
        page,
        items: parsed.modelIds.length,
        next: nextToken ?? null,
      });
    } while (nextToken !== undefined);
    return [...ids];
  }

  private buildGetMetricDataBody(
    queries: ReadonlyArray<{
      id: string;
      metricName: string;
      stat: string;
      modelId: string;
      periodSeconds: number;
    }>,
    startMs: number,
    endMs: number,
    nextToken: string | undefined,
  ): string {
    const params = new URLSearchParams();
    params.set('Action', 'GetMetricData');
    params.set('Version', CLOUDWATCH_API_VERSION);
    params.set('StartTime', new Date(startMs).toISOString());
    params.set('EndTime', new Date(endMs).toISOString());
    params.set('ScanBy', 'TimestampAscending');
    if (nextToken !== undefined) {
      params.set('NextToken', nextToken);
    }
    queries.forEach((q, index) => {
      const prefix = `MetricDataQueries.member.${index + 1}`;
      params.set(`${prefix}.Id`, q.id);
      params.set(`${prefix}.ReturnData`, 'true');
      params.set(`${prefix}.MetricStat.Metric.Namespace`, BEDROCK_NAMESPACE);
      params.set(`${prefix}.MetricStat.Metric.MetricName`, q.metricName);
      params.set(`${prefix}.MetricStat.Period`, String(q.periodSeconds));
      params.set(`${prefix}.MetricStat.Stat`, q.stat);
      params.set(
        `${prefix}.MetricStat.Metric.Dimensions.member.1.Name`,
        MODEL_DIMENSION,
      );
      params.set(
        `${prefix}.MetricStat.Metric.Dimensions.member.1.Value`,
        q.modelId,
      );
    });
    return params.toString();
  }

  private async runMetricDataBatch<TQuery extends { queryId: string }>(
    chunkQueries: ReadonlyArray<{
      id: string;
      metricName: string;
      stat: string;
      modelId: string;
      periodSeconds: number;
    }>,
    queriesById: Map<string, TQuery>,
    onResult: (query: TQuery, result: MetricDataParsedResult) => void,
    window: BedrockWindow,
    resource: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const host = `${CLOUDWATCH_SERVICE}.${this.settings.region}.amazonaws.com`;
    let nextToken: string | undefined;
    let page = 0;
    do {
      if (signal?.aborted) {
        return;
      }
      const body = this.buildGetMetricDataBody(
        chunkQueries,
        window.startMs,
        window.endMs,
        nextToken,
      );
      const signingCredentials = await this.resolveSigningCredentials(signal);
      const xml = await this.signedPost({
        host,
        service: CLOUDWATCH_SERVICE,
        body,
        signingCredentials,
        resource,
        signal,
      });
      const parsed = parseGetMetricData(xml);
      for (const result of parsed.results) {
        const q = queriesById.get(result.id);
        if (q === undefined) {
          continue;
        }
        if (result.statusCode !== 'Complete') {
          this.logger.warn('metric result status not complete', {
            resource,
            id: result.id,
            statusCode: result.statusCode,
          });
        }
        onResult(q, result);
      }
      nextToken = parsed.nextToken ?? undefined;
      page += 1;
      this.logger.info('fetched page', {
        resource,
        page,
        items: parsed.results.length,
        next: nextToken ?? null,
      });
    } while (nextToken !== undefined);
  }

  private async syncUsage(
    options: SyncOptions,
    storage: StorageHandle,
    modelIds: readonly string[],
    window: BedrockWindow,
    periodSeconds: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const activeSpecs = USAGE_METRICS.filter((spec) =>
      this.resourceAllowed(options, spec.outputName),
    );
    if (activeSpecs.length === 0 || modelIds.length === 0) {
      const replaceWindow = bedrockReplaceWindow(window);
      for (const spec of USAGE_METRICS) {
        if (this.resourceAllowed(options, spec.outputName)) {
          await storage.metrics([], {
            names: [spec.outputName],
            ...(replaceWindow ? { replaceWindow } : {}),
          });
        }
      }
      this.logger.info('resource done', {
        resource: 'usage',
        items: 0,
      });
      return;
    }

    const queries: UsageQuery[] = [];
    let queryCounter = 0;
    for (const modelId of modelIds) {
      for (const spec of activeSpecs) {
        queries.push({
          queryId: `u${queryCounter++}`,
          modelId,
          spec,
        });
      }
    }
    const samplesByMetric = new Map<string, MetricSample[]>();
    for (const spec of activeSpecs) {
      samplesByMetric.set(spec.outputName, []);
    }
    const queriesById = new Map(queries.map((q) => [q.queryId, q]));

    for (let i = 0; i < queries.length; i += MAX_QUERIES_PER_CALL) {
      const chunk = queries.slice(i, i + MAX_QUERIES_PER_CALL).map((q) => ({
        id: q.queryId,
        metricName: q.spec.metricName,
        stat: q.spec.stat,
        modelId: q.modelId,
        periodSeconds,
      }));
      await this.runMetricDataBatch(
        chunk,
        queriesById,
        (q, result) => {
          const target = samplesByMetric.get(q.spec.outputName);
          if (target === undefined) {
            return;
          }
          collectSamples(target, q.spec.outputName, q.modelId, periodSeconds, {
            errorType: undefined,
            result,
          });
        },
        window,
        'usage',
        signal,
      );
    }

    const replaceWindow = bedrockReplaceWindow(window);
    let totalItems = 0;
    for (const [metricName, samples] of samplesByMetric.entries()) {
      await storage.metrics(samples, {
        names: [metricName],
        ...(replaceWindow ? { replaceWindow } : {}),
      });
      totalItems += samples.length;
    }
    this.logger.info('resource done', { resource: 'usage', items: totalItems });
  }

  private async syncErrors(
    options: SyncOptions,
    storage: StorageHandle,
    modelIds: readonly string[],
    window: BedrockWindow,
    periodSeconds: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      !this.resourceAllowed(options, ERRORS_METRIC) ||
      modelIds.length === 0
    ) {
      if (this.resourceAllowed(options, ERRORS_METRIC)) {
        const replaceWindow = bedrockReplaceWindow(window);
        await storage.metrics([], {
          names: [ERRORS_METRIC],
          ...(replaceWindow ? { replaceWindow } : {}),
        });
      }
      this.logger.info('resource done', { resource: 'errors', items: 0 });
      return;
    }

    const queries: ErrorQuery[] = [];
    let queryCounter = 0;
    for (const modelId of modelIds) {
      for (const spec of ERROR_METRICS) {
        queries.push({
          queryId: `e${queryCounter++}`,
          modelId,
          spec,
        });
      }
    }
    const queriesById = new Map(queries.map((q) => [q.queryId, q]));
    const samples: MetricSample[] = [];

    for (let i = 0; i < queries.length; i += MAX_QUERIES_PER_CALL) {
      const chunk = queries.slice(i, i + MAX_QUERIES_PER_CALL).map((q) => ({
        id: q.queryId,
        metricName: q.spec.metricName,
        stat: 'Sum',
        modelId: q.modelId,
        periodSeconds,
      }));
      await this.runMetricDataBatch(
        chunk,
        queriesById,
        (q, result) => {
          collectSamples(samples, ERRORS_METRIC, q.modelId, periodSeconds, {
            errorType: q.spec.errorType,
            result,
          });
        },
        window,
        'errors',
        signal,
      );
    }

    const replaceWindow = bedrockReplaceWindow(window);
    await storage.metrics(samples, {
      names: [ERRORS_METRIC],
      ...(replaceWindow ? { replaceWindow } : {}),
    });
    this.logger.info('resource done', {
      resource: 'errors',
      items: samples.length,
    });
  }

  private async syncSpend(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.resourceAllowed(options, SPEND_METRIC)) {
      return;
    }
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const window = getSpendWindow(options, lookbackDays);
    const samples: MetricSample[] = [];
    let nextPageToken: string | undefined;
    let page = 0;
    try {
      do {
        if (signal?.aborted) {
          return;
        }
        const payload: Record<string, unknown> = {
          TimePeriod: { Start: window.start, End: window.end },
          Granularity: 'DAILY',
          Metrics: ['UnblendedCost'],
          Filter: {
            Dimensions: {
              Key: 'SERVICE',
              Values: [BEDROCK_CE_SERVICE_NAME],
            },
          },
          GroupBy: [{ Type: 'DIMENSION', Key: 'USAGE_TYPE' }],
        };
        if (nextPageToken) {
          payload['NextPageToken'] = nextPageToken;
        }
        const parsed = await this.callCostExplorer<CeGetCostAndUsageBody>(
          'GetCostAndUsage',
          payload,
          'spend',
          signal,
        );
        samples.push(...buildSpendSamples(parsed));
        nextPageToken =
          typeof parsed.NextPageToken === 'string' &&
          parsed.NextPageToken.length > 0
            ? parsed.NextPageToken
            : undefined;
        page += 1;
        this.logger.info('fetched page', {
          resource: 'spend',
          page,
          items: parsed.ResultsByTime?.length ?? 0,
          next: nextPageToken ?? null,
        });
      } while (nextPageToken);
    } catch (err) {
      if (isDataUnavailable(err)) {
        const replaceWindow = spendReplaceWindow(window);
        await storage.metrics([], {
          names: [SPEND_METRIC],
          ...(replaceWindow ? { replaceWindow } : {}),
        });
        this.logger.info('resource done', { resource: 'spend', items: 0 });
        return;
      }
      throw err;
    }

    const replaceWindow = spendReplaceWindow(window);
    await storage.metrics(samples, {
      names: [SPEND_METRIC],
      ...(replaceWindow ? { replaceWindow } : {}),
    });
    this.logger.info('resource done', {
      resource: 'spend',
      items: samples.length,
    });
  }

  private async callCostExplorer<T>(
    action: string,
    payload: Record<string, unknown>,
    resource: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const credentials = await this.resolveSigningCredentials(signal);
    const body = JSON.stringify(payload);
    const { amzDate, dateStamp } = formatAmzDate(new Date());
    const payloadHash = await sha256Hex(body);
    const amzTarget = `${CE_TARGET_PREFIX}.${action}`;

    const signedHeaders: Record<string, string> = {
      'content-type': CE_CONTENT_TYPE,
      host: CE_HOST,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'x-amz-target': amzTarget,
    };
    if (credentials.sessionToken !== undefined) {
      signedHeaders['x-amz-security-token'] = credentials.sessionToken;
    }

    const authorization = await createAuthorizationHeader({
      method: 'POST',
      host: CE_HOST,
      path: '/',
      query: '',
      headers: signedHeaders,
      payloadHash,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      region: CE_REGION,
      service: CE_SERVICE,
      amzDate,
      dateStamp,
    });

    const sendHeaders: Record<string, string> = {
      'Content-Type': CE_CONTENT_TYPE,
      'X-Amz-Content-Sha256': payloadHash,
      'X-Amz-Date': amzDate,
      'X-Amz-Target': amzTarget,
      Authorization: authorization,
      'User-Agent': connectorUserAgent(this.id),
    };
    if (credentials.sessionToken !== undefined) {
      sendHeaders['X-Amz-Security-Token'] = credentials.sessionToken;
    }

    try {
      const res = await this.post<unknown>(CE_URL, {
        resource,
        headers: sendHeaders,
        body,
        signal,
      });
      const parsed =
        typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
      return parsed as T;
    } catch (err) {
      throw mapAwsJsonError(err);
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const periodSeconds =
      this.settings.granularitySeconds ?? DEFAULT_GRANULARITY_SECONDS;
    const window = getBedrockWindow(
      options,
      lookbackDays,
      Date.now(),
      periodSeconds,
      this.logger,
    );

    const needsModelIds =
      this.phaseActive(options, 'usage') || this.phaseActive(options, 'errors');
    const modelIds = needsModelIds ? await this.listModelIds(signal) : [];

    for (const phase of PHASE_ORDER) {
      if (signal?.aborted) {
        return { done: false };
      }
      if (!this.phaseActive(options, phase)) {
        continue;
      }
      if (phase === 'usage') {
        await this.syncUsage(
          options,
          storage,
          modelIds,
          window,
          periodSeconds,
          signal,
        );
      } else if (phase === 'errors') {
        await this.syncErrors(
          options,
          storage,
          modelIds,
          window,
          periodSeconds,
          signal,
        );
      } else {
        await this.syncSpend(options, storage, signal);
      }
    }

    return { done: true };
  }
}

function collectSamples(
  samples: MetricSample[],
  metricName: string,
  modelId: string,
  periodSeconds: number,
  extra: {
    errorType?: 'client' | 'server' | 'throttle';
    result: MetricDataParsedResult;
  },
): void {
  const baseAttributes: Record<string, JSONValue> = {
    modelId,
    period: periodSeconds,
    statusCode: extra.result.statusCode,
  };
  if (extra.errorType !== undefined) {
    baseAttributes['errorType'] = extra.errorType;
  }
  const count = Math.min(
    extra.result.timestamps.length,
    extra.result.values.length,
  );
  for (let i = 0; i < count; i++) {
    const ts = parseEpoch(extra.result.timestamps[i]!, 'iso');
    const value = extra.result.values[i]!;
    if (ts === null || !Number.isFinite(value)) {
      continue;
    }
    samples.push({
      name: metricName,
      ts,
      value,
      attributes: { ...baseAttributes },
    });
  }
}
