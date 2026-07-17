import {
  BQ_DATASET_RE,
  BQ_IDENT_RE,
  BQ_READONLY_SCOPE,
  type BqPageRequest,
  type BqQueryResponse,
  GcpAccessTokenProvider,
  MS_PER_DAY,
  bqQueryResponseSchema,
  collectBigQueryPages,
  gcpAuthConfigShape,
  indexBqFields,
  parseBqDateOrEpoch,
  readBqCell as readCell,
  startOfUtcDay,
  toDateStr,
  tokenResponseSchema,
} from '@rawdash/connector-gcp-shared';
import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
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
  schemasFromResources,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    ...gcpAuthConfigShape,
    projectId: z
      .string()
      .regex(BQ_IDENT_RE, 'projectId must be a valid GCP project id')
      .meta({
        label: 'GCP project ID',
        description:
          'Project that hosts the Firebase Cloud Messaging -> BigQuery delivery export (also the project used to bill the BigQuery queries this connector runs).',
        placeholder: 'my-firebase-project',
      }),
    bqDataset: z
      .string()
      .regex(
        BQ_DATASET_RE,
        'bqDataset must be a valid BigQuery dataset id (letters, digits, and underscores; must start with a letter or underscore)',
      )
      .optional()
      .meta({
        label: 'BigQuery dataset',
        description:
          'BigQuery dataset containing the FCM delivery export table. Defaults to firebase_messaging (the default name Firebase uses when you enable the export).',
        placeholder: 'firebase_messaging',
      }),
    bqLocation: z.string().min(1).optional().meta({
      label: 'BigQuery location',
      description:
        'Region or multi-region of the messaging dataset (e.g. US, EU, us-central1). Defaults to US.',
      placeholder: 'US',
    }),
    lookbackDays: z.number().int().positive().max(720).optional().meta({
      label: 'Backfill window (days)',
      description:
        'How many days of history to query on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
    topTopicsLimit: z.number().int().positive().max(500).optional().meta({
      label: 'Top topics limit',
      description:
        'How many topics to retain per day for the per-topic metric, ranked by accepted message count. Defaults to 100.',
      placeholder: '100',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Firebase Cloud Messaging',
  category: 'engineering',
  brandColor: '#FFA000',
  tagline:
    'Track push-notification volume and delivery over time from the Firebase Cloud Messaging -> BigQuery delivery export: daily sends, delivery rate, and per-topic breakdown.',
  vendor: {
    name: 'Firebase',
    domain: 'firebase.google.com',
    apiDocs:
      'https://firebase.google.com/docs/cloud-messaging/understand-delivery',
    website: 'https://firebase.google.com/products/cloud-messaging',
  },
  auth: {
    summary:
      'Authenticate against the BigQuery API with a Google service account JSON key. The service account needs the BigQuery Data Viewer role on the FCM delivery export dataset and the BigQuery Job User role on the project that runs the queries.',
    setup: [
      'Enable the Firebase Cloud Messaging -> BigQuery delivery data export in the Firebase console (Engage -> Messaging -> ... -> BigQuery export, or Project Settings -> Integrations -> BigQuery). This is a manual one-time setup per project; data starts flowing into the firebase_messaging dataset within a day.',
      'Create a service account at Google Cloud -> IAM & Admin -> Service Accounts in the same project (or grant an existing one access).',
      'Grant the service account roles/bigquery.dataViewer on the messaging dataset (so it can read the export table) and roles/bigquery.jobUser on the project (so it can run query jobs).',
      'Generate a JSON key for the service account and store its contents as a secret (e.g. FIREBASE_SA_JSON).',
      'Reference the key from config as serviceAccountJson: secret("FIREBASE_SA_JSON") and set projectId to the Firebase project that owns the export.',
    ],
  },
  rateLimit:
    'BigQuery jobs.query is rate-limited per project; standard 429 / RESOURCE_EXHAUSTED responses are retried with backoff. Each connector sync runs one query per resource.',
  limitations: [
    'Requires the Firebase Cloud Messaging -> BigQuery delivery export to be configured in the Firebase console; that step is manual and one-time per project, and only days after the configuration date are present in the export.',
    'Reads the firebase_messaging.data delivery table. Sends are counted from MESSAGE_ACCEPTED rows and deliveries from MESSAGE_DELIVERED rows; the delivery rate is the daily ratio of the two and is approximate because a message accepted late in a day can be delivered the next day.',
    'The delivery export does not carry notification-open signal, so opens are not synced; link FCM to Google Analytics and use the analytics connector if you need opens.',
    'The delivery export does not carry per-topic subscriber counts, so subscriber/opt-in metrics are not synced; only messages actually sent to a topic are counted in the per-topic metric.',
    'Each BigQuery query is billed against the configured projectId; over long lookback windows the cost adds up. Prefer once-a-day syncs and reasonable lookbackDays.',
    'The delivery export is streamed; the trailing 2 days are always refetched on incremental syncs to pick up late-arriving rows.',
  ],
});

const MESSAGES_PER_DAY_METRIC = 'messages_per_day';
const MESSAGES_PER_TOPIC_METRIC = 'messages_per_topic';
const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_TOP_TOPICS_LIMIT = 100;
const DEFAULT_BQ_DATASET = 'firebase_messaging';
const INCREMENTAL_LOOKBACK_DAYS = 2;
type ResourceName =
  | typeof MESSAGES_PER_DAY_METRIC
  | typeof MESSAGES_PER_TOPIC_METRIC;

export interface FirebaseCloudMessagingSettings {
  projectId: string;
  bqDataset?: string;
  bqLocation?: string;
  lookbackDays?: number;
  topTopicsLimit?: number;
}

const firebaseCloudMessagingCredentials = {
  serviceAccountJson: {
    description: 'Google service account JSON key (raw JSON or base64)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type FirebaseCloudMessagingCredentials =
  typeof firebaseCloudMessagingCredentials;

export const firebaseCloudMessagingResources = defineResources({
  [MESSAGES_PER_DAY_METRIC]: {
    shape: 'metric',
    description:
      'Daily push-notification volume per (date, platform): messages accepted (sent), messages delivered, and the approximate delivery rate. One sample per day per platform present in the FCM delivery export.',
    endpoint: 'POST /bigquery/v2/projects/{projectId}/queries',
    unit: 'messages',
    granularity: 'daily',
    notes:
      'value is the count of MESSAGE_ACCEPTED events (sends). The trailing 2 days are always refetched on incremental syncs to pick up streamed rows.',
    dimensions: [
      {
        name: 'platform',
        description:
          'Recipient app platform of the message (android, ios, web, or unknown).',
      },
      {
        name: 'delivered',
        description: 'Count of MESSAGE_DELIVERED events on this platform/day.',
      },
      {
        name: 'delivery_rate',
        description:
          'Approximate share of accepted messages that were delivered on this platform/day (0..1). null if no messages were accepted.',
      },
    ],
    responses: {
      oauth_token: tokenResponseSchema,
      messages_per_day: bqQueryResponseSchema,
    },
  },
  [MESSAGES_PER_TOPIC_METRIC]: {
    shape: 'metric',
    description:
      'Daily push-notification volume per (date, topic) for topic sends: messages accepted (sent), messages delivered, and the approximate delivery rate. One sample per day per topic, capped at topTopicsLimit topics per day ranked by accepted count.',
    endpoint: 'POST /bigquery/v2/projects/{projectId}/queries',
    unit: 'messages',
    granularity: 'daily',
    notes:
      'value is the count of MESSAGE_ACCEPTED events (sends) for the topic. Only messages with a non-empty topic are counted; direct token and device-group sends are excluded.',
    dimensions: [
      {
        name: 'topic',
        description: 'FCM topic name the message was published to.',
      },
      {
        name: 'delivered',
        description: 'Count of MESSAGE_DELIVERED events for this topic/day.',
      },
      {
        name: 'delivery_rate',
        description:
          'Approximate share of accepted messages that were delivered for this topic/day (0..1). null if no messages were accepted.',
      },
    ],
    responses: {
      messages_per_topic: bqQueryResponseSchema,
    },
  },
});

export const id = 'firebase-cloud-messaging';

export class FirebaseCloudMessagingConnector extends BaseConnector<
  FirebaseCloudMessagingSettings,
  FirebaseCloudMessagingCredentials
> {
  static readonly id = id;

  static readonly resources = firebaseCloudMessagingResources;

  static readonly schemas = schemasFromResources(
    firebaseCloudMessagingResources,
  );

  static create(
    input: unknown,
    ctx?: ConnectorContext,
  ): FirebaseCloudMessagingConnector {
    const parsed = configFields.parse(input);
    return new FirebaseCloudMessagingConnector(
      {
        projectId: parsed.projectId,
        bqDataset: parsed.bqDataset,
        bqLocation: parsed.bqLocation,
        lookbackDays: parsed.lookbackDays,
        topTopicsLimit: parsed.topTopicsLimit,
      },
      { serviceAccountJson: parsed.serviceAccountJson },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = firebaseCloudMessagingCredentials;

  private tokenProvider?: GcpAccessTokenProvider;

  private getAccessToken(signal?: AbortSignal): Promise<string> {
    this.tokenProvider ??= new GcpAccessTokenProvider({
      connectorId: this.id,
      scope: BQ_READONLY_SCOPE,
      getServiceAccountJson: () => this.creds.serviceAccountJson,
      post: (url, opts) =>
        this.post<{ access_token: string; expires_in?: number }>(url, opts),
    });
    return this.tokenProvider.getToken(signal);
  }

  private async fetchBigQueryPage(
    resource: ResourceName,
    request: BqPageRequest,
    signal: AbortSignal | undefined,
  ): Promise<BqQueryResponse> {
    const accessToken = await this.getAccessToken(signal);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': connectorUserAgent(this.id),
    };
    if (request.method === 'POST') {
      const res = await this.post<BqQueryResponse>(request.url, {
        resource,
        headers,
        body: request.body,
        signal,
      });
      return res.body;
    }
    const res = await this.get<BqQueryResponse>(request.url, {
      resource,
      headers,
      signal,
    });
    return res.body;
  }

  private isResourceActive(
    resource: ResourceName,
    options: SyncOptions,
  ): boolean {
    if (!options.resources) {
      return true;
    }
    return options.resources.has(resource);
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const dataset = this.settings.bqDataset ?? DEFAULT_BQ_DATASET;
    const window = getMessagingWindow(
      options,
      this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    );
    const topTopicsLimit =
      this.settings.topTopicsLimit ?? DEFAULT_TOP_TOPICS_LIMIT;
    const replaceWindow = windowToReplaceWindow(window);

    if (this.isResourceActive(MESSAGES_PER_DAY_METRIC, options)) {
      if (signal?.aborted) {
        return { done: false };
      }
      const sql = buildMessagesPerDaySql({
        projectId: this.settings.projectId,
        bqDataset: dataset,
        startDate: window.startDate,
        endDate: window.endDate,
      });
      const samples = await this.collectSamples(
        MESSAGES_PER_DAY_METRIC,
        sql,
        buildMessagesPerDaySamplesFromBqResponse,
        signal,
      );
      if (signal?.aborted) {
        return { done: false };
      }
      await storage.metrics(samples, {
        names: [MESSAGES_PER_DAY_METRIC],
        ...(replaceWindow ? { replaceWindow } : {}),
      });
    }

    if (this.isResourceActive(MESSAGES_PER_TOPIC_METRIC, options)) {
      if (signal?.aborted) {
        return { done: false };
      }
      const sql = buildMessagesPerTopicSql({
        projectId: this.settings.projectId,
        bqDataset: dataset,
        startDate: window.startDate,
        endDate: window.endDate,
        limit: topTopicsLimit,
      });
      const samples = await this.collectSamples(
        MESSAGES_PER_TOPIC_METRIC,
        sql,
        buildMessagesPerTopicSamplesFromBqResponse,
        signal,
      );
      if (signal?.aborted) {
        return { done: false };
      }
      await storage.metrics(samples, {
        names: [MESSAGES_PER_TOPIC_METRIC],
        ...(replaceWindow ? { replaceWindow } : {}),
      });
    }

    return { done: true };
  }

  private jobIncompleteMessage(): string {
    return `${this.id}: BigQuery query did not complete within the synchronous timeout (jobComplete=false). Narrow the lookbackDays so the query finishes faster.`;
  }

  private async collectSamples(
    resource: ResourceName,
    sql: string,
    mapRows: (response: BqQueryResponse) => MetricSample[],
    signal?: AbortSignal,
  ): Promise<MetricSample[]> {
    const { rows } = await collectBigQueryPages<MetricSample>({
      projectId: this.settings.projectId,
      sql,
      resource,
      location: this.settings.bqLocation,
      signal,
      logger: this.logger,
      mapRows,
      jobIncompleteMessage: this.jobIncompleteMessage(),
      fetchPage: (request, sig) =>
        this.fetchBigQueryPage(resource, request, sig),
    });
    return rows;
  }
}

interface MessagingWindow {
  startDate: string;
  endDate: string;
}

function dateStrToMs(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

export function windowToReplaceWindow(
  window: MessagingWindow,
): { start: number; end: number } | null {
  const start = dateStrToMs(window.startDate);
  const end = dateStrToMs(window.endDate) - MS_PER_DAY;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return { start, end };
}

export function buildMessagesPerDaySql(args: {
  projectId: string;
  bqDataset: string;
  startDate: string;
  endDate: string;
}): string {
  const table = `\`${args.projectId}.${args.bqDataset}.data\``;
  return [
    'SELECT',
    '  DATE(event_timestamp) AS date,',
    "  LOWER(IFNULL(sdk_platform, 'unknown')) AS platform,",
    "  COUNTIF(event = 'MESSAGE_ACCEPTED') AS accepted,",
    "  COUNTIF(event = 'MESSAGE_DELIVERED') AS delivered",
    `FROM ${table}`,
    `WHERE DATE(event_timestamp) >= DATE('${args.startDate}')`,
    `  AND DATE(event_timestamp) < DATE('${args.endDate}')`,
    'GROUP BY date, platform',
    'ORDER BY date',
  ].join('\n');
}

export function buildMessagesPerTopicSql(args: {
  projectId: string;
  bqDataset: string;
  startDate: string;
  endDate: string;
  limit: number;
}): string {
  const table = `\`${args.projectId}.${args.bqDataset}.data\``;
  return [
    'SELECT',
    '  date,',
    '  topic,',
    '  accepted,',
    '  delivered',
    'FROM (',
    '  SELECT',
    '    DATE(event_timestamp) AS date,',
    '    topic,',
    "    COUNTIF(event = 'MESSAGE_ACCEPTED') AS accepted,",
    "    COUNTIF(event = 'MESSAGE_DELIVERED') AS delivered,",
    '    ROW_NUMBER() OVER (',
    '      PARTITION BY DATE(event_timestamp)',
    "      ORDER BY COUNTIF(event = 'MESSAGE_ACCEPTED') DESC, topic ASC",
    '    ) AS rn',
    `  FROM ${table}`,
    `  WHERE DATE(event_timestamp) >= DATE('${args.startDate}')`,
    `    AND DATE(event_timestamp) < DATE('${args.endDate}')`,
    '    AND topic IS NOT NULL',
    "    AND topic != ''",
    '  GROUP BY date, topic',
    ')',
    `WHERE rn <= ${args.limit}`,
    'ORDER BY date, accepted DESC, topic ASC',
  ].join('\n');
}

export function getMessagingWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): MessagingWindow {
  const endMs = startOfUtcDay(now) + MS_PER_DAY;
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
  return {
    startDate: toDateStr(endMs - days * MS_PER_DAY),
    endDate: toDateStr(endMs),
  };
}

function deliveryRate(accepted: number, delivered: number): number | null {
  if (!Number.isFinite(accepted) || accepted <= 0) {
    return null;
  }
  const rate = delivered / accepted;
  return Math.max(0, Math.min(1, rate));
}

function readCount(
  cells: ReadonlyArray<{ v?: string | null }>,
  fieldIndex: Record<string, number>,
  name: string,
): number {
  const raw = readCell(cells, fieldIndex, name);
  if (raw === null) {
    return 0;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildMessagesPerDaySamplesFromBqResponse(
  response: z.infer<typeof bqQueryResponseSchema>,
): MetricSample[] {
  const fieldIndex = indexBqFields(response);

  const samples: MetricSample[] = [];
  for (const row of response.rows ?? []) {
    const dateValue = readCell(row.f, fieldIndex, 'date');
    if (dateValue === null) {
      continue;
    }
    const ts = parseBqDateOrEpoch(dateValue);
    if (ts === null) {
      continue;
    }
    const accepted = readCount(row.f, fieldIndex, 'accepted');
    const delivered = readCount(row.f, fieldIndex, 'delivered');
    const platform = readCell(row.f, fieldIndex, 'platform');

    const attributes: Record<string, JSONValue> = {
      platform,
      delivered,
      delivery_rate: deliveryRate(accepted, delivered),
    };

    samples.push({
      name: MESSAGES_PER_DAY_METRIC,
      ts,
      value: accepted,
      attributes,
    });
  }
  return samples;
}

export function buildMessagesPerTopicSamplesFromBqResponse(
  response: z.infer<typeof bqQueryResponseSchema>,
): MetricSample[] {
  const fieldIndex = indexBqFields(response);

  const samples: MetricSample[] = [];
  for (const row of response.rows ?? []) {
    const dateValue = readCell(row.f, fieldIndex, 'date');
    if (dateValue === null) {
      continue;
    }
    const ts = parseBqDateOrEpoch(dateValue);
    if (ts === null) {
      continue;
    }
    const topic = readCell(row.f, fieldIndex, 'topic');
    if (topic === null || topic.length === 0) {
      continue;
    }
    const accepted = readCount(row.f, fieldIndex, 'accepted');
    const delivered = readCount(row.f, fieldIndex, 'delivered');

    const attributes: Record<string, JSONValue> = {
      topic,
      delivered,
      delivery_rate: deliveryRate(accepted, delivered),
    };

    samples.push({
      name: MESSAGES_PER_TOPIC_METRIC,
      ts,
      value: accepted,
      attributes,
    });
  }
  return samples;
}
