import {
  BaseAWSConnector,
  type BaseAWSSettings,
  type SigningCredentials,
  awsAuthConfigShape,
  awsAuthRefine,
  createAuthorizationHeader,
  formatAmzDate,
  sha256Hex,
} from '@rawdash/connector-aws-shared';
import {
  AuthError,
  type HttpResponse,
  RateLimitError,
  TransientError,
  connectorUserAgent,
} from '@rawdash/connector-shared';
import {
  type ChunkedSyncCursor,
  type ConnectorContext,
  type JSONValue,
  type MetricSample,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
} from '@rawdash/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
//
// Cost Explorer is a global service reached through its us-east-1 endpoint, so
// `region` is hardcoded rather than exposed in the connector config.

const { region: _region, ...awsAuthWithoutRegion } = awsAuthConfigShape;

export const configFields = defineConfigFields(
  z
    .object({
      ...awsAuthWithoutRegion,
      granularity: z.enum(['DAILY', 'MONTHLY']).optional().meta({
        label: 'Granularity',
        description:
          'Time granularity of cost buckets. DAILY (default) or MONTHLY. Each Cost Explorer query is billed at $0.01, so MONTHLY is cheaper over long windows.',
      }),
      groupBy: z.array(z.string()).optional().meta({
        label: 'Group by (optional)',
        description:
          'Up to two Cost Explorer dimensions to break costs down by, e.g. SERVICE, LINKED_ACCOUNT, or TAG:Environment. Omit for total cost only.',
      }),
      lookbackDays: z.number().int().positive().optional().meta({
        label: 'Backfill window (days)',
        description:
          'How many days of history to fetch on a full sync. Defaults to 90.',
        placeholder: '90',
      }),
    })
    .refine((val) => awsAuthRefine.predicate({ ...val, region: AWS_REGION }), {
      message: awsAuthRefine.message,
    }),
);

export interface AwsCostSettings extends BaseAWSSettings {
  granularity?: 'DAILY' | 'MONTHLY';
  groupBy?: readonly string[];
  lookbackDays?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AWS_REGION = 'us-east-1';
const CE_HOST = 'ce.us-east-1.amazonaws.com';
const CE_URL = `https://${CE_HOST}/`;
const CE_SERVICE = 'ce';
const CE_CONTENT_TYPE = 'application/x-amz-json-1.1';
const CE_TARGET_PREFIX = 'AWSInsightsIndexService';

const DAILY_METRIC_NAME = 'aws_cost_daily';
const FORECAST_METRIC_NAME = 'aws_cost_forecast';

const DEFAULT_BACKFILL_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 3;
const MS_PER_DAY = 86_400_000;

const PHASE_ORDER = ['daily_cost', 'forecast'] as const;
type AwsCostPhase = (typeof PHASE_ORDER)[number];

// ---------------------------------------------------------------------------
// Schemas — describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const amountString = z.string().regex(/^-?\d+(\.\d+)?$/);
const ceDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const metricAmount = z.object({ Amount: amountString, Unit: z.string() });

const getCostAndUsageResponse = z.object({
  ResultsByTime: z.array(
    z.object({
      TimePeriod: z.object({ Start: ceDateString, End: ceDateString }),
      Total: z.object({ UnblendedCost: metricAmount.optional() }).optional(),
      Groups: z
        .array(
          z.object({
            Keys: z.array(z.string()),
            Metrics: z.object({ UnblendedCost: metricAmount }),
          }),
        )
        .optional(),
      Estimated: z.boolean().optional(),
    }),
  ),
  NextPageToken: z.string().optional(),
});

const getCostForecastResponse = z.object({
  Total: metricAmount.optional(),
  ForecastResultsByTime: z
    .array(
      z.object({
        TimePeriod: z.object({ Start: ceDateString, End: ceDateString }),
        MeanValue: amountString,
        PredictionIntervalLowerBound: amountString.optional(),
        PredictionIntervalUpperBound: amountString.optional(),
      }),
    )
    .optional(),
});

// ---------------------------------------------------------------------------
// Runtime response shapes (intentionally permissive — the wire format is
// `application/x-amz-json-1.1` which the shared client returns as a string,
// so these are parsed defensively rather than trusted)
// ---------------------------------------------------------------------------

interface CostMetricAmount {
  Amount?: string;
  Unit?: string;
}
interface ResultByTime {
  TimePeriod?: { Start?: string; End?: string };
  Total?: Record<string, CostMetricAmount | undefined>;
  Groups?: Array<{
    Keys?: string[];
    Metrics?: Record<string, CostMetricAmount | undefined>;
  }>;
  Estimated?: boolean;
}
interface GetCostAndUsageBody {
  ResultsByTime?: ResultByTime[];
  NextPageToken?: string;
}
interface ForecastResult {
  TimePeriod?: { Start?: string; End?: string };
  MeanValue?: string;
  PredictionIntervalLowerBound?: string;
  PredictionIntervalUpperBound?: string;
}
interface GetCostForecastBody {
  Total?: CostMetricAmount;
  ForecastResultsByTime?: ForecastResult[];
}

// ---------------------------------------------------------------------------
// Error mapping — Cost Explorer signals failures via the JSON `__type` field;
// translate them into the shared error contract the runner understands.
// Detection is structural (`.kind` + `.response`) rather than `instanceof`,
// because the shared error classes are bundled per-package — an `instanceof`
// check against this package's copy would miss errors thrown by core's copy.
// ---------------------------------------------------------------------------

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

function extractAwsErrorType(err: HttpErrorLike): string {
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
  const type = extractAwsErrorType(httpError);
  const status = httpError.response?.status ?? 0;
  if (
    /throttl|TooManyRequests|RequestLimitExceeded/i.test(type) ||
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

function isDataUnavailable(err: unknown): boolean {
  const httpError = asHttpError(err);
  return (
    httpError !== null &&
    /DataUnavailable/i.test(extractAwsErrorType(httpError))
  );
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing
// ---------------------------------------------------------------------------

function parseAmount(value: string | undefined): number {
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

function addMonthsFirstUtc(ms: number, months: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

function groupAttrName(
  groupBy: readonly string[] | undefined,
  index: number,
): string {
  const dim = groupBy?.[index];
  if (!dim) {
    return `dimension_${index}`;
  }
  if (dim.startsWith('TAG:')) {
    return `tag_${dim.slice(4)}`;
  }
  if (dim.startsWith('COST_CATEGORY:')) {
    return `cost_category_${dim.slice(14)}`;
  }
  return dim.toLowerCase();
}

function toGroupDefinition(dim: string): { Type: string; Key: string } {
  if (dim.startsWith('TAG:')) {
    return { Type: 'TAG', Key: dim.slice(4) };
  }
  if (dim.startsWith('COST_CATEGORY:')) {
    return { Type: 'COST_CATEGORY', Key: dim.slice(14) };
  }
  return { Type: 'DIMENSION', Key: dim };
}

export function buildDailyCostSamples(
  body: GetCostAndUsageBody,
  granularity: 'DAILY' | 'MONTHLY',
  groupBy: readonly string[] | undefined,
): MetricSample[] {
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
        const attributes: Record<string, JSONValue> = {
          granularity,
          estimated,
          unit: cost?.Unit ?? 'USD',
        };
        for (let i = 0; i < keys.length; i++) {
          attributes[groupAttrName(groupBy, i)] = keys[i] ?? null;
        }
        samples.push({
          name: DAILY_METRIC_NAME,
          ts,
          value: parseAmount(cost?.Amount),
          attributes,
        });
      }
      continue;
    }
    const cost = result.Total?.['UnblendedCost'];
    if (!cost) {
      continue;
    }
    samples.push({
      name: DAILY_METRIC_NAME,
      ts,
      value: parseAmount(cost.Amount),
      attributes: { granularity, estimated, unit: cost.Unit ?? 'USD' },
    });
  }
  return samples;
}

export function buildForecastSamples(
  body: GetCostForecastBody,
  granularity: 'DAILY' | 'MONTHLY',
): MetricSample[] {
  const unit = body.Total?.Unit ?? 'USD';
  const samples: MetricSample[] = [];
  for (const result of body.ForecastResultsByTime ?? []) {
    const start = result.TimePeriod?.Start;
    if (start === undefined) {
      continue;
    }
    const ts = ceDateToMs(start);
    if (!Number.isFinite(ts)) {
      continue;
    }
    samples.push({
      name: FORECAST_METRIC_NAME,
      ts,
      value: parseAmount(result.MeanValue),
      attributes: {
        granularity,
        unit,
        lowerBound:
          result.PredictionIntervalLowerBound !== undefined
            ? parseAmount(result.PredictionIntervalLowerBound)
            : null,
        upperBound:
          result.PredictionIntervalUpperBound !== undefined
            ? parseAmount(result.PredictionIntervalUpperBound)
            : null,
      },
    });
  }
  return samples;
}

interface CostWindow {
  start: string;
  end: string;
}

export function getCostWindow(
  options: SyncOptions,
  granularity: 'DAILY' | 'MONTHLY',
  lookbackDays: number,
  now: number = Date.now(),
): CostWindow {
  let days = lookbackDays;
  if (options.mode === 'latest') {
    days = INCREMENTAL_LOOKBACK_DAYS;
  } else if (options.since) {
    const sinceMs = Date.parse(options.since);
    if (Number.isFinite(sinceMs)) {
      const elapsed = Math.ceil((now - sinceMs) / MS_PER_DAY);
      days = Math.min(Math.max(elapsed, 1), lookbackDays);
    }
  }

  if (granularity === 'MONTHLY') {
    const months = Math.max(1, Math.ceil(days / 30));
    return {
      start: toDateStr(addMonthsFirstUtc(now, 1 - months)),
      end: toDateStr(addMonthsFirstUtc(now, 1)),
    };
  }

  // End is exclusive; tomorrow 00:00 UTC so the current (estimated) day is
  // included and overwritten on the next sync as it finalizes.
  const end = startOfUtcDay(now) + MS_PER_DAY;
  return { start: toDateStr(end - days * MS_PER_DAY), end: toDateStr(end) };
}

function getForecastWindow(
  granularity: 'DAILY' | 'MONTHLY',
  now: number = Date.now(),
): CostWindow {
  const start = startOfUtcDay(now);
  if (granularity === 'MONTHLY') {
    return {
      start: toDateStr(start),
      end: toDateStr(addMonthsFirstUtc(now, 3)),
    };
  }
  return { start: toDateStr(start), end: toDateStr(start + 31 * MS_PER_DAY) };
}

type AwsCostCursor = ChunkedSyncCursor<AwsCostPhase, CostWindow>;

function isAwsCostCursor(value: unknown): value is AwsCostCursor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const c = value as { phase?: unknown; page?: unknown };
  if (
    typeof c.phase !== 'string' ||
    !(PHASE_ORDER as readonly string[]).includes(c.phase)
  ) {
    return false;
  }
  const p = c.page as { start?: unknown; end?: unknown } | null | undefined;
  if (typeof p !== 'object' || p === null) {
    return false;
  }
  return typeof p.start === 'string' && typeof p.end === 'string';
}

// ---------------------------------------------------------------------------
// AwsCostConnector
// ---------------------------------------------------------------------------

export class AwsCostConnector extends BaseAWSConnector<AwsCostSettings> {
  static readonly id = 'aws-cost';

  static readonly schemas = {
    daily_cost: getCostAndUsageResponse,
    forecast: getCostForecastResponse,
  } as const;

  static create(input: unknown, ctx?: ConnectorContext): AwsCostConnector {
    const parsed = configFields.parse(input);
    return new AwsCostConnector(
      {
        region: AWS_REGION,
        roleArn: parsed.roleArn,
        externalId: parsed.externalId,
        granularity: parsed.granularity,
        groupBy: parsed.groupBy,
        lookbackDays: parsed.lookbackDays,
      },
      {
        accessKeyId: parsed.accessKeyId,
        secretAccessKey: parsed.secretAccessKey,
      },
      ctx,
    );
  }

  readonly id = 'aws-cost';

  private async callCostExplorer<T>(
    action: string,
    payload: Record<string, unknown>,
    resource: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const credentials = await this.resolveSigningCredentials(signal);
    const body = JSON.stringify(payload);
    const headers = await this.buildCeHeaders(action, body, credentials);
    try {
      const res = await this.post<unknown>(CE_URL, {
        resource,
        headers,
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

  private async buildCeHeaders(
    action: string,
    body: string,
    credentials: SigningCredentials,
  ): Promise<Record<string, string>> {
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
      region: AWS_REGION,
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
    return sendHeaders;
  }

  private async syncDailyCost(
    storage: StorageHandle,
    window: CostWindow,
    granularity: 'DAILY' | 'MONTHLY',
    groupBy: readonly string[] | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    const samples: MetricSample[] = [];
    let nextPageToken: string | undefined;
    do {
      const payload: Record<string, unknown> = {
        TimePeriod: { Start: window.start, End: window.end },
        Granularity: granularity,
        Metrics: ['UnblendedCost'],
      };
      if (groupBy && groupBy.length > 0) {
        payload['GroupBy'] = groupBy.slice(0, 2).map(toGroupDefinition);
      }
      if (nextPageToken) {
        payload['NextPageToken'] = nextPageToken;
      }
      const parsed = await this.callCostExplorer<GetCostAndUsageBody>(
        'GetCostAndUsage',
        payload,
        'daily_cost',
        signal,
      );
      samples.push(...buildDailyCostSamples(parsed, granularity, groupBy));
      nextPageToken =
        typeof parsed.NextPageToken === 'string' &&
        parsed.NextPageToken.length > 0
          ? parsed.NextPageToken
          : undefined;
    } while (nextPageToken);

    await storage.metrics(samples, { names: [DAILY_METRIC_NAME] });
  }

  private async syncForecast(
    storage: StorageHandle,
    granularity: 'DAILY' | 'MONTHLY',
    signal?: AbortSignal,
  ): Promise<void> {
    const window = getForecastWindow(granularity);
    let parsed: GetCostForecastBody;
    try {
      parsed = await this.callCostExplorer<GetCostForecastBody>(
        'GetCostForecast',
        {
          TimePeriod: { Start: window.start, End: window.end },
          Metric: 'UNBLENDED_COST',
          Granularity: granularity,
        },
        'forecast',
        signal,
      );
    } catch (err) {
      // A brand-new or low-volume account has no history to forecast from;
      // treat that as "no forecast" rather than failing the whole sync.
      if (isDataUnavailable(err)) {
        await storage.metrics([], { names: [FORECAST_METRIC_NAME] });
        return;
      }
      throw err;
    }
    await storage.metrics(buildForecastSamples(parsed, granularity), {
      names: [FORECAST_METRIC_NAME],
    });
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const granularity = this.settings.granularity ?? 'DAILY';
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_BACKFILL_DAYS;
    const groupBy = this.settings.groupBy;

    const cursor = isAwsCostCursor(options.cursor) ? options.cursor : undefined;
    const page =
      cursor?.page ?? getCostWindow(options, granularity, lookbackDays);

    const resumeIdx = cursor ? PHASE_ORDER.indexOf(cursor.phase) : 0;
    const startIdx = resumeIdx >= 0 ? resumeIdx : 0;

    for (let i = startIdx; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i]!;
      if (signal?.aborted) {
        return { done: false, cursor: { phase, page } };
      }
      if (
        options.resources &&
        options.resources.size > 0 &&
        !options.resources.has(phase)
      ) {
        continue;
      }
      try {
        if (phase === 'daily_cost') {
          await this.syncDailyCost(storage, page, granularity, groupBy, signal);
        } else {
          await this.syncForecast(storage, granularity, signal);
        }
      } catch (err) {
        if (signal?.aborted) {
          return { done: false, cursor: { phase, page } };
        }
        throw err;
      }
    }

    return { done: true };
  }
}
