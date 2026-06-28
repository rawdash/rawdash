import {
  BaseAWSConnector,
  type BaseAWSSettings,
  awsAuthConfigShape,
  awsAuthRefine,
  parseGetMetricData,
} from '@rawdash/connector-aws-shared';
import { TransientError, parseEpoch } from '@rawdash/connector-shared';
import {
  type ConnectorContext,
  type ConnectorDoc,
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
      configurationSets: z.array(z.string().min(1)).optional().meta({
        label: 'Configuration sets (optional)',
        description:
          'SES configuration set names to break email stats down by, in addition to the account-wide totals. Each set must publish its events to CloudWatch (via an event destination). Omit to track account-wide totals only.',
      }),
      lookbackDays: z.number().int().positive().max(455).optional().meta({
        label: 'Backfill window (days)',
        description:
          'How many days of history to fetch on a full sync. Defaults to 30.',
        placeholder: '30',
      }),
    })
    .refine(awsAuthRefine.predicate, { message: awsAuthRefine.message }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Amazon SES',
  category: 'engineering',
  brandColor: '#FF9900',
  tagline:
    'Track Amazon SES transactional email volume, deliverability, and sender reputation as daily metric series, optionally split by configuration set.',
  vendor: {
    name: 'Amazon Web Services',
    domain: 'aws.amazon.com',
    apiDocs:
      'https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-cloudwatch.html',
    website: 'https://aws.amazon.com/ses/',
  },
  auth: {
    summary:
      'SES publishes sending and reputation metrics to the AWS/SES CloudWatch namespace, so this connector reads CloudWatch rather than SES directly. Authenticate with either static IAM access keys or an assumed IAM role (STS). The principal needs `cloudwatch:GetMetricData` in the region your SES account sends from.',
    setup: [
      'Create an IAM user or role with a policy granting `cloudwatch:GetMetricData`.',
      'For static credentials, generate an access key ID and secret access key for that IAM user and store both halves as secrets, then reference them as `accessKeyId: secret("AWS_ACCESS_KEY_ID")` and `secretAccessKey: secret("AWS_SECRET_ACCESS_KEY")`.',
      'For role assumption, set `roleArn` to the role to assume (and `externalId` if its trust policy requires one); the base credentials must be allowed to `sts:AssumeRole` it.',
      'Set `region` to the AWS region your SES account sends from, e.g. `us-east-1`.',
      'To break stats down by configuration set, add a CloudWatch event destination to each set in the SES console and list the set names under `configurationSets`. Open and click metrics require engagement tracking to be enabled on the set.',
    ],
  },
  rateLimit:
    'GetMetricData is batched at most 500 metrics per call with NextToken pagination; throttling (Throttling / RequestLimitExceeded / TooManyRequests) is retried with backoff.',
  limitations: [
    'Metrics are read from CloudWatch, so they reflect whatever SES publishes there; account-wide Send/Delivery/Bounce/Complaint are always available, while per-configuration-set, Open, and Click metrics require the matching CloudWatch event destination and engagement tracking.',
    'Reputation bounce and complaint rates are account-wide only; CloudWatch does not expose them per configuration set.',
    'A full sync uses lookbackDays (default 30); a latest sync refetches a short trailing window so finalized counts overwrite earlier estimates.',
  ],
});

export interface AwsSesSettings extends BaseAWSSettings {
  configurationSets?: readonly string[];
  lookbackDays?: number;
}

export const EMAIL_STATS_METRIC = 'ses_email_stats';
export const REPUTATION_METRIC = 'ses_reputation';

interface SesMetricDef {
  kind: string;
  cloudWatchMetric: string;
  stat: string;
}

const EMAIL_STATS_DEFS: readonly SesMetricDef[] = [
  { kind: 'sends', cloudWatchMetric: 'Send', stat: 'Sum' },
  { kind: 'deliveries', cloudWatchMetric: 'Delivery', stat: 'Sum' },
  { kind: 'bounces', cloudWatchMetric: 'Bounce', stat: 'Sum' },
  { kind: 'complaints', cloudWatchMetric: 'Complaint', stat: 'Sum' },
  { kind: 'opens', cloudWatchMetric: 'Open', stat: 'Sum' },
  { kind: 'clicks', cloudWatchMetric: 'Click', stat: 'Sum' },
];

const REPUTATION_DEFS: readonly SesMetricDef[] = [
  {
    kind: 'bounce_rate',
    cloudWatchMetric: 'Reputation.BounceRate',
    stat: 'Average',
  },
  {
    kind: 'complaint_rate',
    cloudWatchMetric: 'Reputation.ComplaintRate',
    stat: 'Average',
  },
];

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

export const awsSesResources = defineResources({
  ses_email_stats: {
    shape: 'metric',
    description:
      'Daily Amazon SES sending funnel pulled from the AWS/SES CloudWatch namespace. One sample per (day, kind, configuration set); the sample value is the count for that kind. The kind dimension covers sends, deliveries, bounces, complaints, opens, and clicks.',
    endpoint: 'POST / (GetMetricData)',
    granularity: 'daily',
    notes:
      'Account-wide totals are always present; per-configuration-set, open, and click samples appear only when the relevant CloudWatch event destination and engagement tracking are configured. Each sync rewrites the samples for its window so finalized counts overwrite earlier ones.',
    dimensions: [
      {
        name: 'kind',
        description:
          'Which funnel counter the sample measures: sends, deliveries, bounces, complaints, opens, or clicks.',
      },
      {
        name: 'configurationSet',
        description:
          'The SES configuration set the sample is scoped to, or "all" for account-wide totals.',
      },
      {
        name: 'stat',
        description: 'The CloudWatch statistic used, always Sum for stats.',
      },
    ],
    responses: { email_stats: metricDataResponseSchema },
  },
  ses_reputation: {
    shape: 'metric',
    description:
      'Daily account-wide SES sender reputation rates from the AWS/SES CloudWatch namespace. One sample per (day, kind); the value is the rate as a fraction between 0 and 1. The kind dimension is bounce_rate or complaint_rate.',
    endpoint: 'POST / (GetMetricData)',
    granularity: 'daily',
    notes:
      'Reputation rates are account-wide only and are not available per configuration set. Each sync rewrites the samples for its window.',
    dimensions: [
      {
        name: 'kind',
        description:
          'Which reputation rate the sample measures: bounce_rate or complaint_rate.',
      },
      {
        name: 'stat',
        description:
          'The CloudWatch statistic used, always Average for reputation rates.',
      },
    ],
    responses: { reputation: metricDataResponseSchema },
  },
});

const CLOUDWATCH_SERVICE = 'monitoring';
const CLOUDWATCH_API_VERSION = '2010-08-01';
const SES_NAMESPACE = 'AWS/SES';
const CONFIG_SET_DIMENSION = 'ses:configuration-set';
const ACCOUNT_SCOPE = 'all';
const DAILY_PERIOD_SECONDS = 86_400;
const MAX_QUERIES_PER_CALL = 500;
const DEFAULT_LOOKBACK_DAYS = 30;
const INCREMENTAL_LOOKBACK_DAYS = 3;
const MS_PER_DAY = 86_400_000;

interface PlannedQuery {
  id: string;
  metricName: string;
  kind: string;
  cloudWatchMetric: string;
  stat: string;
  configurationSet: string | null;
}

export const id = 'aws-ses';

export class AwsSesConnector extends BaseAWSConnector<AwsSesSettings> {
  static readonly id = id;

  static readonly resources = awsSesResources;

  static readonly schemas = schemasFromResources(awsSesResources);

  static create(input: unknown, ctx?: ConnectorContext): AwsSesConnector {
    const parsed = configFields.parse(input);
    return new AwsSesConnector(
      {
        region: parsed.region,
        roleArn: parsed.roleArn,
        externalId: parsed.externalId,
        configurationSets: parsed.configurationSets,
        lookbackDays: parsed.lookbackDays,
      },
      {
        accessKeyId: parsed.accessKeyId,
        secretAccessKey: parsed.secretAccessKey,
      },
      ctx,
    );
  }

  readonly id = id;

  private planQueries(activeNames: Set<string>): PlannedQuery[] {
    const configSets = this.settings.configurationSets ?? [];
    const queries: PlannedQuery[] = [];
    let counter = 0;
    const nextId = (): string => `m${counter++}`;

    if (activeNames.has(EMAIL_STATS_METRIC)) {
      for (const def of EMAIL_STATS_DEFS) {
        queries.push({
          id: nextId(),
          metricName: EMAIL_STATS_METRIC,
          kind: def.kind,
          cloudWatchMetric: def.cloudWatchMetric,
          stat: def.stat,
          configurationSet: null,
        });
        for (const set of configSets) {
          queries.push({
            id: nextId(),
            metricName: EMAIL_STATS_METRIC,
            kind: def.kind,
            cloudWatchMetric: def.cloudWatchMetric,
            stat: def.stat,
            configurationSet: set,
          });
        }
      }
    }

    if (activeNames.has(REPUTATION_METRIC)) {
      for (const def of REPUTATION_DEFS) {
        queries.push({
          id: nextId(),
          metricName: REPUTATION_METRIC,
          kind: def.kind,
          cloudWatchMetric: def.cloudWatchMetric,
          stat: def.stat,
          configurationSet: null,
        });
      }
    }

    return queries;
  }

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
    const days =
      options.mode === 'latest'
        ? INCREMENTAL_LOOKBACK_DAYS
        : (this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
    return { startMs: endMs - days * MS_PER_DAY, endMs };
  }

  private buildGetMetricDataBody(
    queries: PlannedQuery[],
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
      params.set(`${prefix}.MetricStat.Metric.Namespace`, SES_NAMESPACE);
      params.set(
        `${prefix}.MetricStat.Metric.MetricName`,
        query.cloudWatchMetric,
      );
      params.set(`${prefix}.MetricStat.Period`, String(DAILY_PERIOD_SECONDS));
      params.set(`${prefix}.MetricStat.Stat`, query.stat);
      if (query.configurationSet !== null) {
        const dimPrefix = `${prefix}.MetricStat.Metric.Dimensions.member.1`;
        params.set(`${dimPrefix}.Name`, CONFIG_SET_DIMENSION);
        params.set(`${dimPrefix}.Value`, query.configurationSet);
      }
    });

    return params.toString();
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const allNames = [EMAIL_STATS_METRIC, REPUTATION_METRIC];
    const requested = options.resources;
    const activeNames = new Set(
      allNames.filter(
        (name) => !requested || requested.size === 0 || requested.has(name),
      ),
    );

    if (activeNames.size === 0) {
      this.logger.info('resource skipped', {
        resource: 'email_stats',
        reason: 'no configured resource matches requested resources',
      });
      return { done: true };
    }

    const queries = this.planQueries(activeNames);
    const queriesById = new Map(queries.map((q) => [q.id, q]));
    const { startMs, endMs } = this.computeWindow(options);
    const host = `${CLOUDWATCH_SERVICE}.${this.settings.region}.amazonaws.com`;

    const samplesByName = new Map<string, MetricSample[]>(
      [...activeNames].map((name) => [name, []]),
    );
    let internalErrorSeen = false;

    for (let i = 0; i < queries.length; i += MAX_QUERIES_PER_CALL) {
      const chunk = queries.slice(i, i + MAX_QUERIES_PER_CALL);
      let nextToken: string | undefined;
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
        const signingCredentials = await this.resolveSigningCredentials(signal);
        const xml = await this.signedPost({
          host,
          service: CLOUDWATCH_SERVICE,
          body,
          signingCredentials,
          resource: 'email_stats',
          signal,
        });
        const parsed = parseGetMetricData(xml);
        for (const result of parsed.results) {
          const query = queriesById.get(result.id);
          if (query === undefined) {
            continue;
          }
          if (result.statusCode === 'Forbidden') {
            this.logger.warn('metric result forbidden', {
              resource: 'email_stats',
              metric: query.cloudWatchMetric,
              configurationSet: query.configurationSet,
            });
          } else if (result.statusCode === 'InternalError') {
            internalErrorSeen = true;
            this.logger.warn('metric result internal error', {
              resource: 'email_stats',
              metric: query.cloudWatchMetric,
              configurationSet: query.configurationSet,
            });
          }
          this.collectSamples(
            samplesByName.get(query.metricName)!,
            query,
            result,
          );
        }
        nextToken = parsed.nextToken ?? undefined;
      } while (nextToken !== undefined);
    }

    if (internalErrorSeen) {
      throw new TransientError(
        'GetMetricData returned InternalError for one or more SES series; rescheduling sync',
      );
    }

    const replaceWindow =
      endMs >= startMs ? { start: startMs, end: endMs } : null;
    for (const [name, samples] of samplesByName) {
      await storage.metrics(samples, {
        names: [name],
        ...(replaceWindow ? { replaceWindow } : {}),
      });
      this.logger.info('resource done', {
        resource: name,
        items: samples.length,
      });
    }

    return { done: true };
  }

  private collectSamples(
    samples: MetricSample[],
    query: PlannedQuery,
    result: { timestamps: string[]; values: number[] },
  ): void {
    const attributes: Record<string, JSONValue> = {
      kind: query.kind,
      stat: query.stat,
    };
    if (query.metricName === EMAIL_STATS_METRIC) {
      attributes['configurationSet'] = query.configurationSet ?? ACCOUNT_SCOPE;
    }
    const count = Math.min(result.timestamps.length, result.values.length);
    for (let i = 0; i < count; i++) {
      const ts = parseEpoch(result.timestamps[i]!, 'iso');
      const value = result.values[i]!;
      if (ts === null || !Number.isFinite(value)) {
        continue;
      }
      samples.push({
        name: query.metricName,
        ts,
        value,
        attributes: { ...attributes },
      });
    }
  }
}
