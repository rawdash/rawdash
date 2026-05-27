import {
  BaseAWSConnector,
  type BaseAWSSettings,
  awsAuthConfigShape,
  awsAuthRefine,
  parseGetMetricData,
} from '@rawdash/connector-aws-shared';
import { parseEpoch } from '@rawdash/connector-shared';
import {
  type ConnectorContext,
  type JSONValue,
  type MetricSample,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
} from '@rawdash/core';
import { z } from 'zod';

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
      ...awsAuthConfigShape,
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
    .refine(awsAuthRefine.predicate, { message: awsAuthRefine.message }),
);

export interface CloudWatchMetricQuery {
  id: string;
  namespace: string;
  metric: string;
  stat: string;
  periodSeconds: number;
  dimensions?: Record<string, string>;
}

export interface CloudWatchSettings extends BaseAWSSettings {
  metricQueries: CloudWatchMetricQuery[];
  lookbackMinutes?: number;
}

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

const CLOUDWATCH_SERVICE = 'monitoring';
const CLOUDWATCH_API_VERSION = '2010-08-01';
const MAX_QUERIES_PER_CALL = 500;
const DEFAULT_LOOKBACK_MINUTES = 180;
const MS_PER_MINUTE = 60_000;

export class CloudWatchConnector extends BaseAWSConnector<CloudWatchSettings> {
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
