import {
  type StsCredentials,
  createAuthorizationHeader,
  formatAmzDate,
  parseAssumeRole,
  parseErrorCode,
  parseGetMetricData,
  sha256Hex,
} from '@rawdash/connector-aws-shared';
import {
  AuthError,
  type HttpClientError,
  type HttpResponse,
  RateLimitError,
  TransientError,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type CredentialsSchema,
  type JSONValue,
  type MetricSample,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
} from '@rawdash/core';
import { z } from 'zod';

// Read an environment variable without depending on @types/node — the role
// path falls back to the ambient AWS credentials when no static keys are given.
function readEnv(name: string): string | undefined {
  const env = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  return env?.[name];
}

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

const metricQuerySchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z][a-zA-Z0-9_]*$/,
      'CloudWatch query id must start with a lowercase letter and contain only letters, digits, and underscores',
    ),
  namespace: z.string().min(1),
  metric: z.string().min(1),
  stat: z.string().min(1),
  periodSeconds: z
    .number()
    .int()
    .min(60)
    .refine((n) => n % 60 === 0, {
      message: 'periodSeconds must be a multiple of 60 (1 minute)',
    }),
  dimensions: z.record(z.string(), z.string()).optional(),
});

export const configFields = defineConfigFields(
  z
    .object({
      region: z
        .string()
        .regex(
          /^[a-z0-9-]+$/,
          'region must look like an AWS region, e.g. us-east-1',
        )
        .meta({
          label: 'AWS Region',
          description:
            'The AWS region whose CloudWatch metrics you want to read, e.g. us-east-1.',
          placeholder: 'us-east-1',
        }),
      accessKeyId: z.object({ $secret: z.string() }).optional().meta({
        label: 'Access Key ID',
        description:
          'AWS access key ID for an IAM principal with cloudwatch:GetMetricData. Use this together with the secret access key for static-credential auth.',
        secret: true,
      }),
      secretAccessKey: z.object({ $secret: z.string() }).optional().meta({
        label: 'Secret Access Key',
        description:
          'AWS secret access key paired with the access key ID above.',
        secret: true,
      }),
      roleArn: z
        .string()
        .regex(
          /^arn:aws:iam::\d{12}:role\/.+/,
          'roleArn must be a full IAM role ARN, e.g. arn:aws:iam::123456789012:role/rawdash',
        )
        .optional()
        .meta({
          label: 'Role ARN',
          description:
            'IAM role to assume via STS instead of using static keys. The base credentials (the access key above, or the ambient AWS environment) must be allowed to sts:AssumeRole this role.',
          placeholder: 'arn:aws:iam::123456789012:role/rawdash-cloudwatch',
        }),
      externalId: z.string().min(1).optional().meta({
        label: 'External ID',
        description:
          'External ID required by the trust policy of the role being assumed. Only used with Role ARN.',
      }),
      metricQueries: z.array(metricQuerySchema).nonempty().meta({
        label: 'Metric queries',
        description:
          'CloudWatch is too broad to mirror wholesale — declare the specific metrics to pull. Each query needs an id, namespace, metric name, statistic, and period (seconds, multiple of 60), with optional dimensions.',
      }),
      lookbackMinutes: z.number().int().positive().max(40_320).optional().meta({
        label: 'Lookback (minutes)',
        description:
          'How far back to pull data points on a full sync when the host does not supply a since bound. Defaults to 180.',
        placeholder: '180',
      }),
    })
    .refine(
      (val) =>
        val.roleArn !== undefined ||
        (val.accessKeyId !== undefined && val.secretAccessKey !== undefined),
      {
        message:
          'Provide either accessKeyId + secretAccessKey (static credentials) or roleArn (role assumption)',
      },
    ),
);

// ---------------------------------------------------------------------------
// Settings / credentials
// ---------------------------------------------------------------------------

export interface CloudWatchMetricQuery {
  id: string;
  namespace: string;
  metric: string;
  stat: string;
  periodSeconds: number;
  dimensions?: Record<string, string>;
}

export interface CloudWatchSettings {
  region: string;
  roleArn?: string;
  externalId?: string;
  metricQueries: CloudWatchMetricQuery[];
  lookbackMinutes?: number;
}

const cloudWatchCredentials = {
  accessKeyId: {
    description: 'AWS access key ID',
    auth: 'optional' as const,
  },
  secretAccessKey: {
    description: 'AWS secret access key',
    auth: 'optional' as const,
  },
} satisfies CredentialsSchema;

type CloudWatchCredentials = typeof cloudWatchCredentials;

interface SigningCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

// ---------------------------------------------------------------------------
// Schemas — describe the logical GetMetricData response consumed by request()
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLOUDWATCH_SERVICE = 'monitoring';
const CLOUDWATCH_API_VERSION = '2010-08-01';
const STS_SERVICE = 'sts';
const STS_API_VERSION = '2011-06-15';
const MAX_QUERIES_PER_CALL = 500;
const DEFAULT_LOOKBACK_MINUTES = 180;
const ASSUMED_ROLE_TTL_BUFFER_MS = 60_000;
const ASSUME_ROLE_DURATION_SECONDS = 3600;
const MS_PER_MINUTE = 60_000;
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=utf-8';

// ---------------------------------------------------------------------------
// CloudWatchConnector
// ---------------------------------------------------------------------------

export class CloudWatchConnector extends BaseConnector<
  CloudWatchSettings,
  CloudWatchCredentials
> {
  static readonly id = 'aws-cloudwatch';

  static readonly schemas = {
    metric_data: metricDataResponseSchema,
  } as const;

  static create(input: unknown, ctx?: ConnectorContext): CloudWatchConnector {
    const parsed = configFields.parse(input);
    return new CloudWatchConnector(
      {
        region: parsed.region,
        roleArn: parsed.roleArn,
        externalId: parsed.externalId,
        metricQueries: parsed.metricQueries,
        lookbackMinutes: parsed.lookbackMinutes,
      },
      {
        accessKeyId: parsed.accessKeyId,
        secretAccessKey: parsed.secretAccessKey,
      },
      ctx,
    );
  }

  readonly id = 'aws-cloudwatch';
  override readonly credentials = cloudWatchCredentials;

  private assumedCreds: {
    value: SigningCredentials;
    expiresAt: number;
  } | null = null;

  // -------------------------------------------------------------------------
  // Credential resolution
  // -------------------------------------------------------------------------

  private baseCredentials(): SigningCredentials {
    const { accessKeyId, secretAccessKey } = this.creds;
    if (accessKeyId && secretAccessKey) {
      return { accessKeyId, secretAccessKey };
    }
    const envAccessKeyId = readEnv('AWS_ACCESS_KEY_ID');
    const envSecretAccessKey = readEnv('AWS_SECRET_ACCESS_KEY');
    if (envAccessKeyId && envSecretAccessKey) {
      return {
        accessKeyId: envAccessKeyId,
        secretAccessKey: envSecretAccessKey,
        sessionToken: readEnv('AWS_SESSION_TOKEN') || undefined,
      };
    }
    throw new AuthError(
      'aws-cloudwatch: no AWS credentials available — provide accessKeyId + secretAccessKey, or set them in the environment for role assumption',
    );
  }

  private async resolveSigningCredentials(
    signal?: AbortSignal,
  ): Promise<SigningCredentials> {
    if (this.settings.roleArn === undefined) {
      const { accessKeyId, secretAccessKey } = this.creds;
      if (!accessKeyId || !secretAccessKey) {
        throw new AuthError(
          'aws-cloudwatch: static-credential auth requires both accessKeyId and secretAccessKey',
        );
      }
      return { accessKeyId, secretAccessKey };
    }

    if (this.assumedCreds && Date.now() < this.assumedCreds.expiresAt) {
      return this.assumedCreds.value;
    }
    const assumed = await this.assumeRole(this.settings.roleArn, signal);
    return assumed;
  }

  private async assumeRole(
    roleArn: string,
    signal?: AbortSignal,
  ): Promise<SigningCredentials> {
    const params = new URLSearchParams();
    params.set('Action', 'AssumeRole');
    params.set('Version', STS_API_VERSION);
    params.set('RoleArn', roleArn);
    params.set('RoleSessionName', 'rawdash-aws-cloudwatch');
    params.set('DurationSeconds', String(ASSUME_ROLE_DURATION_SECONDS));
    if (this.settings.externalId !== undefined) {
      params.set('ExternalId', this.settings.externalId);
    }

    const host = `sts.${this.settings.region}.amazonaws.com`;
    const xml = await this.signedPost({
      host,
      service: STS_SERVICE,
      body: params.toString(),
      signingCredentials: this.baseCredentials(),
      resource: 'assume_role',
      signal,
    });

    const parsed = parseAssumeRole(xml);
    if (parsed === null) {
      throw new AuthError(
        'aws-cloudwatch: STS AssumeRole returned no usable credentials',
      );
    }
    this.cacheAssumedCredentials(parsed);
    return {
      accessKeyId: parsed.accessKeyId,
      secretAccessKey: parsed.secretAccessKey,
      sessionToken: parsed.sessionToken || undefined,
    };
  }

  private cacheAssumedCredentials(parsed: StsCredentials): void {
    const expirationMs = parseEpoch(parsed.expiration, 'iso');
    const expiresAt =
      expirationMs !== null
        ? expirationMs - ASSUMED_ROLE_TTL_BUFFER_MS
        : Date.now() + (ASSUME_ROLE_DURATION_SECONDS - 60) * 1000;
    this.assumedCreds = {
      value: {
        accessKeyId: parsed.accessKeyId,
        secretAccessKey: parsed.secretAccessKey,
        sessionToken: parsed.sessionToken || undefined,
      },
      expiresAt,
    };
  }

  // -------------------------------------------------------------------------
  // Signed transport
  // -------------------------------------------------------------------------

  private async signedPost(args: {
    host: string;
    service: string;
    body: string;
    signingCredentials: SigningCredentials;
    resource: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const { amzDate, dateStamp } = formatAmzDate(new Date());
    const payloadHash = await sha256Hex(args.body);

    const signedHeaders: Record<string, string> = {
      host: args.host,
      'content-type': FORM_CONTENT_TYPE,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (args.signingCredentials.sessionToken !== undefined) {
      signedHeaders['x-amz-security-token'] =
        args.signingCredentials.sessionToken;
    }

    const authorization = await createAuthorizationHeader({
      method: 'POST',
      host: args.host,
      path: '/',
      query: '',
      headers: signedHeaders,
      payloadHash,
      accessKeyId: args.signingCredentials.accessKeyId,
      secretAccessKey: args.signingCredentials.secretAccessKey,
      region: this.settings.region,
      service: args.service,
      amzDate,
      dateStamp,
    });

    // `host` is set by the runtime from the URL; everything else is sent
    // verbatim. Extra unsigned headers added by the shared client are ignored
    // by AWS because they are not listed in SignedHeaders.
    const sendHeaders: Record<string, string> = {
      'content-type': FORM_CONTENT_TYPE,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'user-agent': connectorUserAgent('aws-cloudwatch'),
      Authorization: authorization,
    };
    if (args.signingCredentials.sessionToken !== undefined) {
      sendHeaders['x-amz-security-token'] =
        args.signingCredentials.sessionToken;
    }

    try {
      const res: HttpResponse<string> = await this.request<string>(
        {
          url: `https://${args.host}/`,
          method: 'POST',
          headers: sendHeaders,
          body: args.body,
          parseJson: false,
          signal: args.signal,
        },
        { resource: args.resource },
      );
      return res.body;
    } catch (err) {
      throw this.classifyAwsError(err);
    }
  }

  // CloudWatch and STS return AWS error codes inside the (XML) body even on a
  // 400 — map the documented ones to the shared error taxonomy so the host
  // backs off / pauses / retries correctly.
  private classifyAwsError(err: unknown): unknown {
    if (!(err instanceof Error) || !('kind' in err)) {
      return err;
    }
    const httpErr = err as HttpClientError;
    const body =
      typeof httpErr.response?.body === 'string' ? httpErr.response.body : '';
    const code = parseErrorCode(body) ?? '';
    const status = httpErr.response?.status ?? 0;

    if (
      /throttl|RequestLimitExceeded|TooManyRequests|LimitExceeded/i.test(code)
    ) {
      return new RateLimitError(httpErr.message, httpErr.response);
    }
    if (
      /AccessDenied|UnrecognizedClient|InvalidClientTokenId|SignatureDoesNotMatch|AuthFailure|InvalidAccessKeyId|Forbidden/i.test(
        code,
      )
    ) {
      return new AuthError(httpErr.message, httpErr.response);
    }
    if (status >= 500) {
      return new TransientError(httpErr.message, httpErr.response);
    }
    return err;
  }

  // -------------------------------------------------------------------------
  // GetMetricData request building
  // -------------------------------------------------------------------------

  private computeWindow(options: SyncOptions): {
    startMs: number;
    endMs: number;
  } {
    const endMs = Date.now();
    if (options.since) {
      const sinceMs = parseEpoch(options.since, 'iso');
      if (sinceMs !== null) {
        return { startMs: Math.min(sinceMs, endMs), endMs };
      }
    }
    if (options.mode === 'latest') {
      const maxPeriod = Math.max(
        ...this.settings.metricQueries.map((q) => q.periodSeconds),
        60,
      );
      return { startMs: endMs - maxPeriod * 3 * 1000, endMs };
    }
    const lookback = this.settings.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;
    return { startMs: endMs - lookback * MS_PER_MINUTE, endMs };
  }

  private buildGetMetricDataBody(
    queries: CloudWatchMetricQuery[],
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

    queries.forEach((query, index) => {
      const prefix = `MetricDataQueries.member.${index + 1}`;
      params.set(`${prefix}.Id`, query.id);
      params.set(`${prefix}.ReturnData`, 'true');
      params.set(`${prefix}.MetricStat.Metric.Namespace`, query.namespace);
      params.set(`${prefix}.MetricStat.Metric.MetricName`, query.metric);
      params.set(`${prefix}.MetricStat.Period`, String(query.periodSeconds));
      params.set(`${prefix}.MetricStat.Stat`, query.stat);
      const dimensions = Object.entries(query.dimensions ?? {});
      dimensions.forEach(([name, value], dimIndex) => {
        const dimPrefix = `${prefix}.MetricStat.Metric.Dimensions.member.${dimIndex + 1}`;
        params.set(`${dimPrefix}.Name`, name);
        params.set(`${dimPrefix}.Value`, value);
      });
    });

    return params.toString();
  }

  // -------------------------------------------------------------------------
  // sync
  // -------------------------------------------------------------------------

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const queries = this.settings.metricQueries;
    const names = new Set(queries.map((q) => `${q.namespace}/${q.metric}`));

    if (queries.length === 0) {
      return { done: true };
    }

    const queriesById = new Map(queries.map((q) => [q.id, q]));
    const { startMs, endMs } = this.computeWindow(options);
    const signingCredentials = await this.resolveSigningCredentials(signal);

    const samples: MetricSample[] = [];
    const host = `${CLOUDWATCH_SERVICE}.${this.settings.region}.amazonaws.com`;

    for (let i = 0; i < queries.length; i += MAX_QUERIES_PER_CALL) {
      const chunk = queries.slice(i, i + MAX_QUERIES_PER_CALL);
      let nextToken: string | undefined;
      let page = 0;
      do {
        if (signal?.aborted) {
          return { done: false };
        }
        const body = this.buildGetMetricDataBody(
          chunk,
          startMs,
          endMs,
          nextToken,
        );
        const xml = await this.signedPost({
          host,
          service: CLOUDWATCH_SERVICE,
          body,
          signingCredentials,
          resource: 'metric_data',
          signal,
        });
        const parsed = parseGetMetricData(xml);
        for (const result of parsed.results) {
          const query = queriesById.get(result.id);
          if (query === undefined) {
            continue;
          }
          this.collectSamples(samples, query, result);
        }
        nextToken = parsed.nextToken ?? undefined;
        page += 1;
        this.logger.info('fetched page', {
          resource: 'metric_data',
          page,
          items: parsed.results.length,
          next: nextToken ?? null,
        });
      } while (nextToken !== undefined);
    }

    await storage.metrics(samples, { names: [...names] });
    this.logger.info('resource done', {
      resource: 'metric_data',
      items: samples.length,
    });
    return { done: true };
  }

  private collectSamples(
    samples: MetricSample[],
    query: CloudWatchMetricQuery,
    result: {
      timestamps: string[];
      values: number[];
      statusCode: string;
      label: string;
    },
  ): void {
    const name = `${query.namespace}/${query.metric}`;
    const baseAttributes: Record<string, JSONValue> = {
      ...(query.dimensions ?? {}),
      stat: query.stat,
      period: query.periodSeconds,
      queryId: query.id,
      statusCode: result.statusCode,
      label: result.label,
    };
    const count = Math.min(result.timestamps.length, result.values.length);
    for (let i = 0; i < count; i++) {
      const ts = parseEpoch(result.timestamps[i]!, 'iso');
      const value = result.values[i]!;
      if (ts === null || !Number.isFinite(value)) {
        continue;
      }
      samples.push({ name, ts, value, attributes: { ...baseAttributes } });
    }
  }
}
