import {
  type HttpResponse,
  connectorUserAgent,
  mapWithConcurrency,
  parseEpoch,
  sanitizeAllowedUrl,
  standardRateLimitPolicy,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type FetchSpec,
  type FilterClause,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  makeChunkedCursorGuard,
  paginateChunked,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    authToken: z.object({ $secret: z.string() }).meta({
      label: 'Auth Token',
      description:
        'Sentry Internal Integration token or User Auth Token. Create one at Sentry → Settings → Auth Tokens (or for an org, Settings → Custom Integrations → New Internal Integration).',
      placeholder: 'sntrys_...',
      secret: true,
    }),
    organization: z.string().min(1).meta({
      label: 'Organization slug',
      description: "Your Sentry organization's slug, as it appears in the URL.",
      placeholder: 'acme',
    }),
    projects: z.array(z.string().min(1)).nonempty().optional().meta({
      label: 'Projects (optional)',
      description:
        'Restrict the sync to specific Sentry project slugs (or numeric IDs). Omit to sync every project the token can see.',
    }),
    resources: z
      .array(z.enum(['issues', 'issue_events', 'releases', 'errors_per_hour']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Sentry resources to sync. Omit to sync all of them. 'issue_events' depends on 'issues' being fetched - enabling it without 'issues' still runs the issues query, but skips writing issue entities.",
      }),
    eventsPerIssueCap: z.number().int().positive().max(100).optional().meta({
      label: 'Events per issue cap',
      description:
        'Maximum number of recent events (occurrences) to sample per issue on each sync. Defaults to 100 (the max page size Sentry allows for the issue events endpoint).',
      placeholder: '100',
    }),
    statsLookbackHours: z.number().int().positive().max(168).optional().meta({
      label: 'Stats lookback (hours)',
      description:
        'How many hours of hourly error-rate data to refresh on each sync. Defaults to 24.',
      placeholder: '24',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Sentry',
  category: 'engineering',
  brandColor: '#362D59',
  tagline:
    'Sync issues, issue events, releases, and hourly error rates from a Sentry organization.',
  vendor: {
    name: 'Sentry',
    domain: 'sentry.io',
    apiDocs: 'https://docs.sentry.io/api/',
    website: 'https://sentry.io',
  },
  auth: {
    summary:
      'A Sentry auth token is required. Use an organization-level Internal Integration token or a User Auth Token with read access to issues, events, and releases.',
    setup: [
      'Open Sentry → Settings → Custom Integrations → New Internal Integration (or Settings → Auth Tokens for a personal token).',
      'Grant read access to Issues & Events and Releases.',
      'Copy the generated token and store it as a secret, referencing it from the connector config as `authToken: secret("SENTRY_AUTH_TOKEN")`.',
      'Set the `organization` slug as it appears in your Sentry URL.',
    ],
  },
  rateLimit:
    'Sentry returns X-Sentry-Rate-Limit-Remaining / X-Sentry-Rate-Limit-Reset headers (reset in seconds); list pagination uses the Link header (page size 100).',
  limitations: [
    'Performance / trace data is out of scope (high cost, low signal for dashboards).',
    'Self-hosted Sentry on custom hosts is out of scope (pagination URLs are pinned to sentry.io).',
  ],
});

export type SentryResource =
  | 'issues'
  | 'issue_events'
  | 'releases'
  | 'errors_per_hour';

export interface SentrySettings {
  organization: string;
  projects?: readonly string[];
  resources?: readonly SentryResource[];
  eventsPerIssueCap?: number;
  statsLookbackHours?: number;
}

const sentryCredentials = {
  authToken: {
    description: 'Sentry auth token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type SentryCredentials = typeof sentryCredentials;

const sentryRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-sentry-rate-limit-remaining',
  resetHeader: 'x-sentry-rate-limit-reset',
  resetUnit: 's',
});

const PHASE_ORDER = ['issues', 'releases', 'error_stats'] as const;

type SentryPhase = (typeof PHASE_ORDER)[number];

type SentrySyncCursor = ChunkedSyncCursor<SentryPhase, string>;

const isSentrySyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

interface SentryProjectRef {
  id?: string | number;
  slug: string;
  name?: string;
  platform?: string;
}

interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  level: string;
  status: string;
  firstSeen: string;
  lastSeen: string;
  count: string | number;
  userCount: number;
  project: SentryProjectRef;
}

interface SentryIssueEvent {
  id?: string;
  eventID?: string;
  dateCreated: string;
  message?: string | null;
  platform?: string | null;
  groupID?: string;
  environment?: string | null;
}

interface SentryRelease {
  version: string;
  dateCreated: string;
  dateReleased?: string | null;
  lastEvent?: string | null;
  projects: SentryProjectRef[];
}

interface SentryStatsResponse {
  intervals?: string[];
  groups: Array<{
    by: Record<string, string | number>;
    totals?: Record<string, number>;
    series?: Record<string, number[]>;
  }>;
  start?: string;
  end?: string;
}

interface IssuesPageItem {
  issues: SentryIssue[];
  eventsByIssue: Map<string, SentryIssueEvent[]>;
}

interface SentryLink {
  url: string;
  hasResults: boolean;
}

function parseSentryLink(
  header: string | null,
  rel: string,
): SentryLink | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*(.+)$/);
    if (!m) {
      continue;
    }
    const url = m[1]!;
    const attrs = m[2]!;
    const relMatch = attrs.match(/rel="([^"]+)"/);
    if (!relMatch || relMatch[1] !== rel) {
      continue;
    }
    const resultsMatch = attrs.match(/results="([^"]+)"/);
    const hasResults = resultsMatch ? resultsMatch[1] === 'true' : true;
    return { url, hasResults };
  }
  return null;
}

const SENTRY_API_HOST = 'sentry.io';
const SENTRY_API_BASE = `https://${SENTRY_API_HOST}/api/0`;
const DEFAULT_EVENTS_PER_ISSUE = 100;
const DEFAULT_STATS_LOOKBACK_HOURS = 24;
const MAX_PAGE_SIZE = 100;
const ISSUES_PAGE_SIZE = 100;
const RELEASES_PAGE_SIZE = 100;
const EVENT_FETCH_CONCURRENCY = 5;
const CHUNK_BUDGET_MS = 25_000;

function clampPageSize(
  requested: number | undefined,
  fallback: number,
): number {
  const n = requested ?? fallback;
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

const idString = z.string().min(1);

const issueResponseSchema = z.array(
  z.object({
    id: idString,
    shortId: z.string(),
    title: z.string(),
    level: z.enum(['debug', 'info', 'warning', 'error', 'fatal']),
    status: z.enum(['resolved', 'unresolved', 'ignored']),
    firstSeen: z.iso.datetime(),
    lastSeen: z.iso.datetime(),
    count: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
    userCount: z.number().int().nonnegative(),
    project: z.object({
      slug: z.string().min(1),
      id: z.union([idString, z.number()]).optional(),
      name: z.string().optional(),
      platform: z.string().nullable().optional(),
    }),
    annotations: z.unknown().optional(),
    assignedTo: z.unknown().nullable().optional(),
    culprit: z.string().nullable().optional(),
    filtered: z.unknown().nullable().optional(),
    hasSeen: z.boolean().optional(),
    isBookmarked: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    isSubscribed: z.boolean().optional(),
    isUnhandled: z.boolean().optional(),
    issueCategory: z.string().optional(),
    issueType: z.string().optional(),
    lifetime: z.unknown().optional(),
    logger: z.string().nullable().optional(),
    metadata: z.unknown().optional(),
    numComments: z.number().int().nonnegative().optional(),
    permalink: z.string().optional(),
    platform: z.string().nullable().optional(),
    priority: z.string().optional(),
    priorityLockedAt: z.iso.datetime().nullable().optional(),
    seerAutofixLastTriggered: z.iso.datetime().nullable().optional(),
    seerExplorerAutofixLastTriggered: z.iso.datetime().nullable().optional(),
    seerFixabilityScore: z.number().nullable().optional(),
    shareId: z.string().nullable().optional(),
    stats: z.unknown().optional(),
    statusDetails: z.unknown().optional(),
    subscriptionDetails: z.unknown().nullable().optional(),
    substatus: z.string().nullable().optional(),
    type: z.string().optional(),
  }),
);

const issueEventResponseSchema = z.array(
  z.object({
    id: z.string().optional(),
    eventID: z.string().optional(),
    dateCreated: z.iso.datetime(),
    message: z.string().nullable().optional(),
    platform: z.string().nullable().optional(),
    groupID: z.string().optional(),
    environment: z.string().nullable().optional(),
    crashFile: z.unknown().nullable().optional(),
    culprit: z.string().optional(),
    'event.type': z.string().optional(),
    location: z.string().optional(),
    metadata: z.unknown().optional(),
    projectID: z.string().optional(),
    tags: z.unknown().optional(),
    title: z.string().optional(),
    user: z.unknown().optional(),
  }),
);

const releaseResponseSchema = z.array(
  z.object({
    version: idString,
    dateCreated: z.iso.datetime(),
    dateReleased: z.iso.datetime().nullable().optional(),
    lastEvent: z.iso.datetime().nullable().optional(),
    projects: z.array(
      z.object({
        slug: z.string().min(1),
        hasHealthData: z.unknown().optional(),
        id: z.unknown().optional(),
        name: z.unknown().optional(),
        newGroups: z.unknown().optional(),
        platform: z.unknown().optional(),
        platforms: z.unknown().optional(),
      }),
    ),
    authors: z.unknown().optional(),
    commitCount: z.unknown().optional(),
    currentProjectMeta: z.unknown().optional(),
    data: z.unknown().optional(),
    deployCount: z.unknown().optional(),
    firstEvent: z.unknown().nullable().optional(),
    id: z.unknown().optional(),
    lastCommit: z.unknown().optional(),
    lastDeploy: z.unknown().optional(),
    newGroups: z.unknown().optional(),
    owner: z.unknown().optional(),
    ref: z.unknown().nullable().optional(),
    shortVersion: z.unknown().optional(),
    status: z.unknown().optional(),
    url: z.unknown().nullable().optional(),
    userAgent: z.unknown().nullable().optional(),
    versionInfo: z.unknown().optional(),
  }),
);

const errorStatsResponseSchema = z.object({
  intervals: z.array(z.iso.datetime()).optional(),
  groups: z.array(
    z.object({
      by: z.record(z.string(), z.union([z.string(), z.number()])),
      totals: z.record(z.string(), z.number()).optional(),
      series: z.record(z.string(), z.array(z.number())).optional(),
    }),
  ),
  start: z.string().optional(),
  end: z.string().optional(),
});

export const sentryResources = defineResources({
  sentry_issue: {
    shape: 'entity',
    description:
      'Sentry issues (error groups) with level, status, occurrence count, affected user count, and first/last seen timestamps.',
    endpoint: 'GET /api/0/organizations/{organization}/issues/',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: ['resolved', 'unresolved', 'ignored'],
      },
      {
        field: 'level',
        ops: ['eq'],
        values: ['fatal', 'error', 'warning', 'info', 'debug', 'sample'],
      },
    ],
    responses: { issues: issueResponseSchema },
  },
  sentry_issue_event: {
    shape: 'event',
    description:
      'Individual event occurrences sampled per issue, with platform, environment, level, and message.',
    endpoint: 'GET /api/0/issues/{issueId}/events/',
    notes:
      'Events are sampled: at most eventsPerIssueCap recent events per issue per sync (Sentry caps a single events page at 100), so this is a representative sample, not a full audit trail.',
    filterable: [],
    responses: { issue_events: issueEventResponseSchema },
  },
  sentry_release: {
    shape: 'entity',
    description:
      'Releases with their versions, associated project slugs, and creation/release/last-event timestamps.',
    endpoint: 'GET /api/0/organizations/{organization}/releases/',
    filterable: [],
    responses: { releases: releaseResponseSchema },
  },
  sentry_errors_per_hour: {
    shape: 'metric',
    description:
      'Hourly count of accepted (stored) error events, broken down by project, over the configured lookback window.',
    endpoint: 'GET /api/0/organizations/{organization}/stats_v2/',
    unit: 'errors',
    granularity: '1h',
    dimensions: [
      { name: 'project', description: 'Sentry project slug or id.' },
    ],
    responses: { error_stats: errorStatsResponseSchema },
  },
});

export const id = 'sentry';

function pushableIssueQueryTerms(filter: FilterClause[] | undefined): string[] {
  if (!filter) {
    return [];
  }
  const terms: string[] = [];
  for (const clause of filter) {
    if (!('field' in clause) || clause.op !== 'eq') {
      continue;
    }
    if (clause.field === 'status' && typeof clause.value === 'string') {
      terms.push(`is:${clause.value}`);
    } else if (clause.field === 'level' && typeof clause.value === 'string') {
      terms.push(`level:${clause.value}`);
    }
  }
  return terms;
}

export class SentryConnector extends BaseConnector<
  SentrySettings,
  SentryCredentials
> {
  static readonly id = id;

  static readonly resources = sentryResources;

  static readonly schemas = schemasFromResources(sentryResources);

  static create(input: unknown, ctx?: ConnectorContext): SentryConnector {
    const parsed = configFields.parse(input);
    return new SentryConnector(
      {
        organization: parsed.organization,
        projects: parsed.projects,
        resources: parsed.resources,
        eventsPerIssueCap: parsed.eventsPerIssueCap,
        statsLookbackHours: parsed.statsLookbackHours,
      },
      { authToken: parsed.authToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = sentryCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.authToken}`,
      'User-Agent': connectorUserAgent('sentry'),
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
      rateLimit: sentryRateLimit,
    });
  }

  private activePhases(): SentryPhase[] {
    return selectActivePhases<SentryResource, SentryPhase>(
      (r) => {
        switch (r) {
          case 'issues':
          case 'issue_events':
            return 'issues';
          case 'releases':
            return 'releases';
          case 'errors_per_hour':
            return 'error_stats';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
  }

  private allowedPagePath(phase: SentryPhase): string | null {
    const org = this.settings.organization;
    switch (phase) {
      case 'issues':
        return `/api/0/organizations/${org}/issues/`;
      case 'releases':
        return `/api/0/organizations/${org}/releases/`;
      case 'error_stats':
        return null;
    }
  }

  private sanitizePageUrl(
    phase: SentryPhase,
    pageUrl: string | null,
  ): string | null {
    const allowedPath = this.allowedPagePath(phase);
    if (allowedPath === null) {
      return null;
    }
    return sanitizeAllowedUrl({
      url: pageUrl,
      host: SENTRY_API_HOST,
      pathname: allowedPath,
    });
  }

  private resolveCursor(cursor: unknown): SentrySyncCursor | undefined {
    if (!isSentrySyncCursor(cursor)) {
      return undefined;
    }
    return {
      phase: cursor.phase,
      page: this.sanitizePageUrl(cursor.phase, cursor.page),
    };
  }

  private buildInitialIssuesUrl(
    options: SyncOptions,
    spec?: FetchSpec,
  ): string {
    const u = new URL(
      `${SENTRY_API_BASE}/organizations/${this.settings.organization}/issues/`,
    );
    u.searchParams.set(
      'limit',
      String(clampPageSize(options.pageSize, ISSUES_PAGE_SIZE)),
    );
    u.searchParams.set('sort', 'date');
    for (const project of this.settings.projects ?? []) {
      u.searchParams.append('project', project);
    }
    const queryTerms: string[] = [];
    if (options.since) {
      queryTerms.push(`lastSeen:>${options.since}`);
    }
    queryTerms.push(...pushableIssueQueryTerms(spec?.filter));
    if (queryTerms.length > 0) {
      u.searchParams.set('query', queryTerms.join(' '));
    }
    return u.toString();
  }

  private singleSpec(
    options: SyncOptions,
    resource: string,
  ): FetchSpec | undefined {
    const specs = options.fetchSpecs?.[resource];
    return specs && specs.length === 1 ? specs[0] : undefined;
  }

  private buildInitialReleasesUrl(options: SyncOptions): string {
    const u = new URL(
      `${SENTRY_API_BASE}/organizations/${this.settings.organization}/releases/`,
    );
    u.searchParams.set(
      'per_page',
      String(clampPageSize(options.pageSize, RELEASES_PAGE_SIZE)),
    );
    u.searchParams.set('sort', 'date');
    for (const project of this.settings.projects ?? []) {
      u.searchParams.append('project', project);
    }
    return u.toString();
  }

  private buildStatsUrl(): string {
    const lookback =
      this.settings.statsLookbackHours ?? DEFAULT_STATS_LOOKBACK_HOURS;
    const u = new URL(
      `${SENTRY_API_BASE}/organizations/${this.settings.organization}/stats_v2/`,
    );
    u.searchParams.set('field', 'sum(quantity)');
    u.searchParams.set('category', 'error');
    u.searchParams.set('outcome', 'accepted');
    u.searchParams.set('interval', '1h');
    u.searchParams.set('statsPeriod', `${lookback}h`);
    u.searchParams.append('groupBy', 'project');
    const projects = this.settings.projects ?? [];
    if (projects.length > 0) {
      for (const project of projects) {
        u.searchParams.append('project', project);
      }
    } else {
      u.searchParams.append('project', '-1');
    }
    return u.toString();
  }

  private buildIssueEventsUrl(issueId: string): string {
    const cap = this.settings.eventsPerIssueCap ?? DEFAULT_EVENTS_PER_ISSUE;
    const u = new URL(`${SENTRY_API_BASE}/issues/${issueId}/events/`);
    u.searchParams.set(
      'limit',
      String(Math.min(cap, DEFAULT_EVENTS_PER_ISSUE)),
    );
    return u.toString();
  }

  private async fetchIssuesPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: IssuesPageItem[]; next: string | null }> {
    const url =
      page ??
      this.buildInitialIssuesUrl(
        options,
        this.singleSpec(options, 'sentry_issue'),
      );
    const res = await this.fetch<SentryIssue[]>(url, 'issues', signal);

    const nextLink = parseSentryLink(res.headers.get('link'), 'next');
    const next =
      nextLink && nextLink.hasResults
        ? this.sanitizePageUrl('issues', nextLink.url)
        : null;

    const eventsByIssue = new Map<string, SentryIssueEvent[]>();
    if (this.isResourceEnabled('issue_events')) {
      signal?.throwIfAborted();
      const fetched = await mapWithConcurrency(
        res.body,
        EVENT_FETCH_CONCURRENCY,
        async (issue) => {
          const eventsRes = await this.fetch<SentryIssueEvent[]>(
            this.buildIssueEventsUrl(issue.id),
            'issue_events',
            signal,
          );
          return [issue.id, eventsRes.body] as const;
        },
      );
      for (const [issueId, events] of fetched) {
        eventsByIssue.set(issueId, events);
      }
    }

    return { items: [{ issues: res.body, eventsByIssue }], next };
  }

  private async fetchReleasesPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: SentryRelease[]; next: string | null }> {
    const url = page ?? this.buildInitialReleasesUrl(options);
    const res = await this.fetch<SentryRelease[]>(url, 'releases', signal);
    const nextLink = parseSentryLink(res.headers.get('link'), 'next');
    const releases = res.body;
    const cutoff = options.since ? new Date(options.since).getTime() : null;
    const filtered =
      cutoff !== null
        ? releases.filter((r) => {
            const ts = new Date(r.dateCreated).getTime();
            return Number.isFinite(ts) ? ts >= cutoff : true;
          })
        : releases;
    const lastRelease = releases.at(-1);
    const lastTs = lastRelease
      ? new Date(lastRelease.dateCreated).getTime()
      : null;
    const cutoffReached =
      cutoff !== null &&
      lastTs !== null &&
      Number.isFinite(lastTs) &&
      lastTs < cutoff;
    const next =
      !cutoffReached && nextLink && nextLink.hasResults
        ? this.sanitizePageUrl('releases', nextLink.url)
        : null;
    return { items: filtered, next };
  }

  private async fetchErrorStats(
    signal: AbortSignal | undefined,
  ): Promise<{ items: SentryStatsResponse[]; next: string | null }> {
    const res = await this.fetch<SentryStatsResponse>(
      this.buildStatsUrl(),
      'error_stats',
      signal,
    );
    return { items: [res.body], next: null };
  }

  private async writeIssuesPage(
    storage: StorageHandle,
    item: IssuesPageItem,
  ): Promise<void> {
    const writeEntities = this.isResourceEnabled('issues');
    const writeEvents = this.isResourceEnabled('issue_events');

    for (const issue of item.issues) {
      if (writeEntities) {
        const count =
          typeof issue.count === 'string' ? Number(issue.count) : issue.count;
        const firstSeenMs = parseEpoch(issue.firstSeen, 'iso');
        const lastSeenMs = parseEpoch(issue.lastSeen, 'iso');
        if (firstSeenMs === null || lastSeenMs === null) {
          console.warn(
            `[connector-sentry] skipping issue ${issue.id} with unparseable firstSeen/lastSeen`,
          );
        } else {
          await storage.entity({
            type: 'sentry_issue',
            id: issue.id,
            attributes: {
              shortId: issue.shortId,
              title: issue.title,
              level: issue.level,
              status: issue.status,
              firstSeen: firstSeenMs,
              lastSeen: lastSeenMs,
              count: Number.isFinite(count) ? count : 0,
              userCount: issue.userCount,
              projectSlug: issue.project.slug,
            },
            updated_at: lastSeenMs,
          });
        }
      }

      if (writeEvents) {
        const events = item.eventsByIssue.get(issue.id) ?? [];
        for (const ev of events) {
          const eventId = ev.eventID ?? ev.id ?? null;
          if (eventId === null) {
            continue;
          }
          const startTs = parseEpoch(ev.dateCreated, 'iso');
          if (startTs === null) {
            continue;
          }
          await storage.event({
            name: 'sentry_issue_event',
            start_ts: startTs,
            end_ts: null,
            attributes: {
              eventId,
              issueId: issue.id,
              issueShortId: issue.shortId,
              projectSlug: issue.project.slug,
              level: issue.level,
              platform: ev.platform ?? null,
              environment: ev.environment ?? null,
              message: ev.message ?? null,
            },
          });
        }
      }
    }
  }

  private async writeReleases(
    storage: StorageHandle,
    releases: SentryRelease[],
  ): Promise<void> {
    for (const r of releases) {
      const createdMs = parseEpoch(r.dateCreated, 'iso');
      const releasedMs = parseEpoch(r.dateReleased, 'iso');
      const lastEventMs = parseEpoch(r.lastEvent, 'iso');
      if (createdMs === null) {
        console.warn(
          `[connector-sentry] skipping release ${r.version} with unparseable dateCreated`,
        );
        continue;
      }
      await storage.entity({
        type: 'sentry_release',
        id: r.version,
        attributes: {
          version: r.version,
          projects: r.projects.map((p) => p.slug),
          dateCreated: createdMs,
          dateReleased: releasedMs,
          lastEvent: lastEventMs,
        },
        updated_at: Math.max(createdMs, releasedMs ?? 0, lastEventMs ?? 0),
      });
    }
  }

  private async writeErrorStats(
    storage: StorageHandle,
    stats: SentryStatsResponse,
  ): Promise<void> {
    const samples: Array<{
      name: string;
      ts: number;
      value: number;
      attributes: Record<string, string | number>;
    }> = [];

    let intervals = stats.intervals ?? [];
    if (intervals.length === 0 && stats.start) {
      const seriesLen = stats.groups.reduce((max, group) => {
        const len = group.series?.['sum(quantity)']?.length ?? 0;
        return Math.max(max, len);
      }, 0);
      const startMs = parseEpoch(stats.start, 'iso');
      if (seriesLen > 0 && startMs !== null) {
        intervals = Array.from({ length: seriesLen }, (_, i) =>
          new Date(startMs + i * 3_600_000).toISOString(),
        );
      }
    }

    for (const group of stats.groups) {
      const project = group.by['project'];
      const projectKey = project !== undefined ? String(project) : 'unknown';
      const series = group.series?.['sum(quantity)'] ?? [];
      for (let i = 0; i < intervals.length; i++) {
        const intervalIso = intervals[i];
        if (intervalIso === undefined) {
          continue;
        }
        const ts = parseEpoch(intervalIso, 'iso');
        if (ts === null) {
          continue;
        }
        const rawValue = series[i];
        const value = rawValue === undefined ? 0 : Number(rawValue);
        if (!Number.isFinite(value)) {
          continue;
        }
        samples.push({
          name: 'sentry_errors_per_hour',
          ts,
          value,
          attributes: { project: projectKey },
        });
      }
    }
    await storage.metrics(samples, { names: ['sentry_errors_per_hour'] });
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';
    const phases = this.activePhases();

    return paginateChunked<SentryPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      pipeline: true,
      maxChunkMs: CHUNK_BUDGET_MS,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'issues':
            return this.fetchIssuesPage(page, options, sig);
          case 'releases':
            return this.fetchReleasesPage(page, options, sig);
          case 'error_stats':
            return this.fetchErrorStats(sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (isFull && page === null) {
          switch (phase) {
            case 'issues':
              if (this.isResourceEnabled('issues')) {
                await storage.entities([], { types: ['sentry_issue'] });
              }
              if (this.isResourceEnabled('issue_events')) {
                await storage.events([], { names: ['sentry_issue_event'] });
              }
              break;
            case 'releases':
              await storage.entities([], { types: ['sentry_release'] });
              break;
            case 'error_stats':
              break;
          }
        }
        switch (phase) {
          case 'issues':
            for (const item of items as IssuesPageItem[]) {
              await this.writeIssuesPage(storage, item);
            }
            return;
          case 'releases':
            return this.writeReleases(storage, items as SentryRelease[]);
          case 'error_stats':
            for (const stats of items as SentryStatsResponse[]) {
              await this.writeErrorStats(storage, stats);
            }
            return;
        }
      },
    });
  }
}
