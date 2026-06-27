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
  type Entity,
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
          'Project that hosts the Firebase Crashlytics -> BigQuery export (also the project used to bill the BigQuery queries this connector runs).',
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
          'BigQuery dataset containing the Crashlytics export tables. Defaults to firebase_crashlytics (the default name Firebase uses when you enable the export).',
        placeholder: 'firebase_crashlytics',
      }),
    bqLocation: z.string().min(1).optional().meta({
      label: 'BigQuery location',
      description:
        'Region or multi-region of the Crashlytics dataset (e.g. US, EU, us-central1). Defaults to US.',
      placeholder: 'US',
    }),
    lookbackDays: z.number().int().positive().max(720).optional().meta({
      label: 'Backfill window (days)',
      description:
        'How many days of history to query on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
    topIssuesLimit: z.number().int().positive().max(500).optional().meta({
      label: 'Top issues limit',
      description:
        'How many top issues to retain per sync, ranked by event count over the backfill window. Defaults to 50.',
      placeholder: '50',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Firebase Crashlytics',
  category: 'engineering',
  brandColor: '#FFA000',
  tagline:
    'Track mobile app reliability over time from the Firebase Crashlytics -> BigQuery export: daily crashes, crash-free user rate, and top issues by impact.',
  vendor: {
    name: 'Firebase',
    domain: 'firebase.google.com',
    apiDocs: 'https://firebase.google.com/docs/crashlytics/bigquery-export',
    website: 'https://firebase.google.com/products/crashlytics',
  },
  auth: {
    summary:
      'Authenticate against the BigQuery API with a Google service account JSON key. The service account needs the BigQuery Data Viewer role on the Crashlytics export dataset and the BigQuery Job User role on the project that runs the queries.',
    setup: [
      'Enable the Firebase Crashlytics -> BigQuery export in the Firebase console (Project Settings -> Integrations -> BigQuery). This is a manual one-time setup per project; data starts flowing into the firebase_crashlytics dataset within a day.',
      'Create a service account at Google Cloud -> IAM & Admin -> Service Accounts in the same project (or grant an existing one access).',
      'Grant the service account roles/bigquery.dataViewer on the Crashlytics dataset (so it can read the export tables) and roles/bigquery.jobUser on the project (so it can run query jobs).',
      'Generate a JSON key for the service account and store its contents as a secret (e.g. FIREBASE_SA_JSON).',
      'Reference the key from config as serviceAccountJson: secret("FIREBASE_SA_JSON") and set projectId to the Firebase project that owns the export.',
    ],
  },
  rateLimit:
    'BigQuery jobs.query is rate-limited per project; standard 429 / RESOURCE_EXHAUSTED responses are retried with backoff. Each connector sync runs one query per resource.',
  limitations: [
    'Requires the Firebase Crashlytics -> BigQuery export to be configured in the Firebase console; that step is manual and one-time per project, and only days after the configuration date are present in the export.',
    'Reads the firebase_crashlytics.<bundle>_<platform> tables via a wildcard; one row in storage covers one app/version/platform tuple per day.',
    'Crash-free user rate is approximated from the daily ratio of unique crashing users to total event users observed in the export; matching the Firebase console number exactly requires the full Crashlytics signal, not just the BigQuery export.',
    'Each BigQuery query is billed against the configured projectId; over long lookback windows the cost adds up. Prefer once-a-day syncs and reasonable lookbackDays.',
    'The Crashlytics BigQuery export is streamed; the trailing 2 days are always refetched on incremental syncs to pick up late-arriving rows.',
  ],
});

const CRASHES_METRIC_NAME = 'crashes_per_day';
const TOP_ISSUES_ENTITY_TYPE = 'firebase_crashlytics_issue';
const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_TOP_ISSUES_LIMIT = 50;
const DEFAULT_BQ_DATASET = 'firebase_crashlytics';
const INCREMENTAL_LOOKBACK_DAYS = 2;
type ResourceName = typeof CRASHES_METRIC_NAME | 'top_issues';

export interface FirebaseCrashlyticsSettings {
  projectId: string;
  bqDataset?: string;
  bqLocation?: string;
  lookbackDays?: number;
  topIssuesLimit?: number;
}

const firebaseCrashlyticsCredentials = {
  serviceAccountJson: {
    description: 'Google service account JSON key (raw JSON or base64)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type FirebaseCrashlyticsCredentials = typeof firebaseCrashlyticsCredentials;

export const firebaseCrashlyticsResources = defineResources({
  [CRASHES_METRIC_NAME]: {
    shape: 'metric',
    description:
      'Daily crash counts and approximate crash-free user rate per (date, application version, platform). One sample per day per app/version/platform combination present in the Crashlytics BigQuery export.',
    endpoint: 'POST /bigquery/v2/projects/{projectId}/queries',
    unit: 'crashes',
    granularity: 'daily',
    notes:
      'Reads from firebase_crashlytics.<bundle>_<platform>_* via a wildcard. The trailing 2 days are always refetched on incremental syncs to pick up streamed rows.',
    dimensions: [
      {
        name: 'app_id',
        description:
          'Bundle identifier (iOS) or package name (Android) of the app the crash was recorded against.',
      },
      {
        name: 'platform',
        description: 'Application platform (ios, android, or unknown).',
      },
      {
        name: 'version',
        description: 'Application display version (e.g. 2.4.1).',
      },
      {
        name: 'crash_free_user_rate',
        description:
          'Approximate share of users on this app/version/day that did not see a crash (0..1). null if no user signal was captured.',
      },
      {
        name: 'crashing_users',
        description:
          'Count of distinct users that experienced at least one crash on this app/version/day.',
      },
    ],
    responses: {
      oauth_token: tokenResponseSchema,
      crashes_per_day: bqQueryResponseSchema,
    },
  },
  top_issues: {
    shape: 'entity',
    filterable: [],
    description:
      'Top crash issues by event count over the backfill window, ranked across all apps and versions present in the export. One entity per Crashlytics issue id.',
    endpoint: 'POST /bigquery/v2/projects/{projectId}/queries',
    notes:
      'topIssuesLimit caps how many issues are retained per sync (default 50). Rows are sorted by descending event count over the backfill window.',
    fields: [
      {
        name: 'issue_id',
        description: 'Stable Crashlytics issue identifier.',
      },
      {
        name: 'title',
        description:
          'Issue title (most recent value seen for this issue id within the window).',
      },
      {
        name: 'subtitle',
        description:
          'Issue subtitle (most recent value seen for this issue id within the window).',
      },
      {
        name: 'app_id',
        description:
          'Bundle identifier (iOS) or package name (Android) most recently seen for this issue.',
      },
      {
        name: 'platform',
        description: 'Application platform (ios, android, or unknown).',
      },
      {
        name: 'event_count',
        description:
          'Total crash events attributed to this issue within the backfill window.',
      },
      {
        name: 'user_count',
        description:
          'Distinct users that experienced this issue within the backfill window.',
      },
      {
        name: 'last_seen',
        description:
          'ISO timestamp of the most recent event for this issue within the window.',
      },
    ],
    responses: {
      top_issues: bqQueryResponseSchema,
    },
  },
});

export const id = 'firebase-crashlytics';

export class FirebaseCrashlyticsConnector extends BaseConnector<
  FirebaseCrashlyticsSettings,
  FirebaseCrashlyticsCredentials
> {
  static readonly id = id;

  static readonly resources = firebaseCrashlyticsResources;

  static readonly schemas = schemasFromResources(firebaseCrashlyticsResources);

  static create(
    input: unknown,
    ctx?: ConnectorContext,
  ): FirebaseCrashlyticsConnector {
    const parsed = configFields.parse(input);
    return new FirebaseCrashlyticsConnector(
      {
        projectId: parsed.projectId,
        bqDataset: parsed.bqDataset,
        bqLocation: parsed.bqLocation,
        lookbackDays: parsed.lookbackDays,
        topIssuesLimit: parsed.topIssuesLimit,
      },
      { serviceAccountJson: parsed.serviceAccountJson },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = firebaseCrashlyticsCredentials;

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
    const window = getCrashlyticsWindow(
      options,
      this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    );
    const topIssuesLimit =
      this.settings.topIssuesLimit ?? DEFAULT_TOP_ISSUES_LIMIT;

    if (this.isResourceActive(CRASHES_METRIC_NAME, options)) {
      if (signal?.aborted) {
        return { done: false };
      }
      const sql = buildCrashesPerDaySql({
        projectId: this.settings.projectId,
        bqDataset: dataset,
        startDate: window.startDate,
        endDate: window.endDate,
      });
      const samples = await this.collectSamples(sql, signal);
      if (signal?.aborted) {
        return { done: false };
      }
      const replaceWindow = windowToReplaceWindow(window);
      await storage.metrics(samples, {
        names: [CRASHES_METRIC_NAME],
        ...(replaceWindow ? { replaceWindow } : {}),
      });
    }

    if (this.isResourceActive('top_issues', options)) {
      if (signal?.aborted) {
        return { done: false };
      }
      const sql = buildTopIssuesSql({
        projectId: this.settings.projectId,
        bqDataset: dataset,
        startDate: window.startDate,
        endDate: window.endDate,
        limit: topIssuesLimit,
      });
      const entities = await this.collectIssues(sql, signal);
      if (signal?.aborted) {
        return { done: false };
      }
      await storage.entities(entities, { types: [TOP_ISSUES_ENTITY_TYPE] });
    }

    return { done: true };
  }

  private jobIncompleteMessage(): string {
    return `${this.id}: BigQuery query did not complete within the synchronous timeout (jobComplete=false). Narrow the lookbackDays so the query finishes faster.`;
  }

  private async collectSamples(
    sql: string,
    signal?: AbortSignal,
  ): Promise<MetricSample[]> {
    const { rows } = await collectBigQueryPages<MetricSample>({
      projectId: this.settings.projectId,
      sql,
      resource: CRASHES_METRIC_NAME,
      location: this.settings.bqLocation,
      signal,
      logger: this.logger,
      mapRows: buildCrashesSamplesFromBqResponse,
      jobIncompleteMessage: this.jobIncompleteMessage(),
      fetchPage: (request, sig) =>
        this.fetchBigQueryPage(CRASHES_METRIC_NAME, request, sig),
    });
    return rows;
  }

  private async collectIssues(
    sql: string,
    signal?: AbortSignal,
  ): Promise<Entity[]> {
    const { rows } = await collectBigQueryPages<Entity>({
      projectId: this.settings.projectId,
      sql,
      resource: 'top_issues',
      location: this.settings.bqLocation,
      signal,
      logger: this.logger,
      mapRows: buildTopIssuesEntitiesFromBqResponse,
      jobIncompleteMessage: this.jobIncompleteMessage(),
      fetchPage: (request, sig) =>
        this.fetchBigQueryPage('top_issues', request, sig),
    });
    return rows;
  }
}

interface CrashlyticsWindow {
  startDate: string;
  endDate: string;
}

function dateStrToMs(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

export function windowToReplaceWindow(
  window: CrashlyticsWindow,
): { start: number; end: number } | null {
  const start = dateStrToMs(window.startDate);
  const end = dateStrToMs(window.endDate) - MS_PER_DAY;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return { start, end };
}

export function buildCrashesPerDaySql(args: {
  projectId: string;
  bqDataset: string;
  startDate: string;
  endDate: string;
}): string {
  const table = `\`${args.projectId}.${args.bqDataset}.*\``;
  return [
    'WITH events AS (',
    '  SELECT',
    '    DATE(event_timestamp) AS date,',
    '    application.bundle_id AS app_id,',
    "    LOWER(IFNULL(application.platform, 'unknown')) AS platform,",
    '    application.app_display_version AS version,',
    '    user.id AS user_id,',
    '    is_fatal',
    `  FROM ${table}`,
    `  WHERE DATE(event_timestamp) >= DATE('${args.startDate}')`,
    `    AND DATE(event_timestamp) < DATE('${args.endDate}')`,
    ')',
    'SELECT',
    '  date,',
    '  app_id,',
    '  platform,',
    '  version,',
    '  COUNTIF(is_fatal) AS crashes,',
    '  COUNT(DISTINCT IF(is_fatal, user_id, NULL)) AS crashing_users,',
    '  COUNT(DISTINCT user_id) AS total_users',
    'FROM events',
    'GROUP BY date, app_id, platform, version',
    'ORDER BY date',
  ].join('\n');
}

export function buildTopIssuesSql(args: {
  projectId: string;
  bqDataset: string;
  startDate: string;
  endDate: string;
  limit: number;
}): string {
  const table = `\`${args.projectId}.${args.bqDataset}.*\``;
  return [
    'SELECT',
    '  issue_id,',
    '  ANY_VALUE(issue_title HAVING MAX event_timestamp) AS title,',
    '  ANY_VALUE(issue_subtitle HAVING MAX event_timestamp) AS subtitle,',
    '  ANY_VALUE(application.bundle_id HAVING MAX event_timestamp) AS app_id,',
    "  LOWER(IFNULL(ANY_VALUE(application.platform HAVING MAX event_timestamp), 'unknown')) AS platform,",
    '  COUNT(*) AS event_count,',
    '  COUNT(DISTINCT user.id) AS user_count,',
    '  MAX(event_timestamp) AS last_seen',
    `FROM ${table}`,
    `WHERE DATE(event_timestamp) >= DATE('${args.startDate}')`,
    `  AND DATE(event_timestamp) < DATE('${args.endDate}')`,
    '  AND issue_id IS NOT NULL',
    'GROUP BY issue_id',
    'ORDER BY event_count DESC, last_seen DESC, issue_id ASC',
    `LIMIT ${args.limit}`,
  ].join('\n');
}

export function getCrashlyticsWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): CrashlyticsWindow {
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

export function buildCrashesSamplesFromBqResponse(
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
    const crashesRaw = readCell(row.f, fieldIndex, 'crashes');
    if (crashesRaw === null) {
      continue;
    }
    const crashes = Number.parseFloat(crashesRaw);
    if (!Number.isFinite(crashes)) {
      continue;
    }
    const crashingUsersRaw = readCell(row.f, fieldIndex, 'crashing_users');
    const totalUsersRaw = readCell(row.f, fieldIndex, 'total_users');
    const crashingUsers =
      crashingUsersRaw !== null ? Number.parseFloat(crashingUsersRaw) : NaN;
    const totalUsers =
      totalUsersRaw !== null ? Number.parseFloat(totalUsersRaw) : NaN;

    let crashFreeRate: number | null = null;
    if (
      Number.isFinite(totalUsers) &&
      totalUsers > 0 &&
      Number.isFinite(crashingUsers)
    ) {
      const rate = 1 - crashingUsers / totalUsers;
      crashFreeRate = Math.max(0, Math.min(1, rate));
    }

    const attributes: Record<string, JSONValue> = {};
    const appId = readCell(row.f, fieldIndex, 'app_id');
    const platform = readCell(row.f, fieldIndex, 'platform');
    const version = readCell(row.f, fieldIndex, 'version');
    attributes['app_id'] = appId;
    attributes['platform'] = platform;
    attributes['version'] = version;
    attributes['crash_free_user_rate'] = crashFreeRate;
    attributes['crashing_users'] = Number.isFinite(crashingUsers)
      ? crashingUsers
      : null;

    samples.push({
      name: CRASHES_METRIC_NAME,
      ts,
      value: crashes,
      attributes,
    });
  }
  return samples;
}

export function buildTopIssuesEntitiesFromBqResponse(
  response: z.infer<typeof bqQueryResponseSchema>,
): Entity[] {
  const fieldIndex = indexBqFields(response);

  const entities: Entity[] = [];
  for (const row of response.rows ?? []) {
    const issueId = readCell(row.f, fieldIndex, 'issue_id');
    if (issueId === null || issueId.length === 0) {
      continue;
    }
    const eventCountRaw = readCell(row.f, fieldIndex, 'event_count');
    const userCountRaw = readCell(row.f, fieldIndex, 'user_count');
    const eventCount =
      eventCountRaw !== null ? Number.parseFloat(eventCountRaw) : NaN;
    const userCount =
      userCountRaw !== null ? Number.parseFloat(userCountRaw) : NaN;
    const lastSeenRaw = readCell(row.f, fieldIndex, 'last_seen');
    const lastSeenMs =
      lastSeenRaw !== null ? parseBqDateOrEpoch(lastSeenRaw) : null;
    const updatedAt = lastSeenMs ?? Date.now();

    const attributes: Record<string, JSONValue> = {
      issue_id: issueId,
      title: readCell(row.f, fieldIndex, 'title'),
      subtitle: readCell(row.f, fieldIndex, 'subtitle'),
      app_id: readCell(row.f, fieldIndex, 'app_id'),
      platform: readCell(row.f, fieldIndex, 'platform'),
      event_count: Number.isFinite(eventCount) ? eventCount : 0,
      user_count: Number.isFinite(userCount) ? userCount : 0,
      last_seen:
        lastSeenMs !== null ? new Date(lastSeenMs).toISOString() : null,
    };

    entities.push({
      type: TOP_ISSUES_ENTITY_TYPE,
      id: issueId,
      attributes,
      updated_at: updatedAt,
    });
  }
  return entities;
}
