import { type HttpResponse, sentryRateLimit } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  paginateChunked,
} from '@rawdash/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

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
          "Which Sentry resources to sync. Omit to sync all of them. 'issue_events' depends on 'issues' being fetched — enabling it without 'issues' still runs the issues query, but skips writing issue entities.",
      }),
    eventsPerIssueCap: z.number().int().positive().max(1000).optional().meta({
      label: 'Events per issue cap',
      description:
        'Maximum number of recent events (occurrences) to sample per issue on each sync. Defaults to 100.',
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

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = ['issues', 'releases', 'error_stats'] as const;

type SentryPhase = (typeof PHASE_ORDER)[number];

type SentrySyncCursor = ChunkedSyncCursor<SentryPhase, string>;

function isSentrySyncCursor(value: unknown): value is SentrySyncCursor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { phase?: unknown; page?: unknown };
  if (typeof v.phase !== 'string') {
    return false;
  }
  if (!(PHASE_ORDER as readonly string[]).includes(v.phase)) {
    return false;
  }
  if (v.page !== null && typeof v.page !== 'string') {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Sentry API types
// ---------------------------------------------------------------------------

interface SentryProjectRef {
  id?: string | number;
  slug: string;
  name?: string;
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
  dateReleased: string | null;
  lastEvent: string | null;
  projects: SentryProjectRef[];
}

interface SentryStatsResponse {
  intervals: string[];
  groups: Array<{
    by: Record<string, string | number>;
    totals?: Record<string, number>;
    series: Record<string, number[]>;
  }>;
  start?: string;
  end?: string;
}

interface IssuesPageItem {
  issues: SentryIssue[];
  eventsByIssue: Map<string, SentryIssueEvent[]>;
}

// ---------------------------------------------------------------------------
// Link header parsing — Sentry uses Web Linking RFC 5988 plus `results="..."`
// to indicate whether a given direction has more pages. parseLinkHeader from
// connector-shared captures the URL but not the `results` flag, so we parse
// the raw header here.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SentryConnector
// ---------------------------------------------------------------------------

const SENTRY_API_HOST = 'sentry.io';
const SENTRY_API_BASE = `https://${SENTRY_API_HOST}/api/0`;
const DEFAULT_EVENTS_PER_ISSUE = 100;
const DEFAULT_STATS_LOOKBACK_HOURS = 24;
const ISSUES_PAGE_SIZE = 100;
const RELEASES_PAGE_SIZE = 100;

export class SentryConnector extends BaseConnector<
  SentrySettings,
  SentryCredentials
> {
  static readonly id = 'sentry';

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

  readonly id = 'sentry';
  override readonly credentials = sentryCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.authToken}`,
      'User-Agent': 'rawdash/connector-sentry (+https://rawdash.dev)',
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

  // -------------------------------------------------------------------------
  // Resource enablement
  // -------------------------------------------------------------------------

  private isResourceEnabled(resource: SentryResource): boolean {
    const enabled = this.settings.resources;
    if (!enabled || enabled.length === 0) {
      return true;
    }
    return enabled.includes(resource);
  }

  private activePhases(): SentryPhase[] {
    const phases: SentryPhase[] = [];
    if (
      this.isResourceEnabled('issues') ||
      this.isResourceEnabled('issue_events')
    ) {
      phases.push('issues');
    }
    if (this.isResourceEnabled('releases')) {
      phases.push('releases');
    }
    if (this.isResourceEnabled('errors_per_hour')) {
      phases.push('error_stats');
    }
    return phases;
  }

  // -------------------------------------------------------------------------
  // URL building + sanitization
  // -------------------------------------------------------------------------

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
    if (pageUrl === null) {
      return null;
    }
    const allowedPath = this.allowedPagePath(phase);
    if (allowedPath === null) {
      return null;
    }
    try {
      const u = new URL(pageUrl);
      if (
        u.protocol !== 'https:' ||
        u.host !== SENTRY_API_HOST ||
        u.pathname !== allowedPath
      ) {
        return null;
      }
      return u.toString();
    } catch {
      return null;
    }
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

  private buildInitialIssuesUrl(options: SyncOptions): string {
    const u = new URL(
      `${SENTRY_API_BASE}/organizations/${this.settings.organization}/issues/`,
    );
    u.searchParams.set('limit', String(ISSUES_PAGE_SIZE));
    u.searchParams.set('sort', 'date');
    for (const project of this.settings.projects ?? []) {
      u.searchParams.append('project', project);
    }
    if (options.mode === 'latest' && options.since) {
      u.searchParams.set('query', `lastSeen:>${options.since}`);
    }
    return u.toString();
  }

  private buildInitialReleasesUrl(): string {
    const u = new URL(
      `${SENTRY_API_BASE}/organizations/${this.settings.organization}/releases/`,
    );
    u.searchParams.set('per_page', String(RELEASES_PAGE_SIZE));
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
    u.searchParams.set('interval', '1h');
    u.searchParams.set('statsPeriod', `${lookback}h`);
    u.searchParams.append('groupBy', 'project');
    for (const project of this.settings.projects ?? []) {
      u.searchParams.append('project', project);
    }
    return u.toString();
  }

  private buildIssueEventsUrl(issueId: string): string {
    const cap = this.settings.eventsPerIssueCap ?? DEFAULT_EVENTS_PER_ISSUE;
    const u = new URL(`${SENTRY_API_BASE}/issues/${issueId}/events/`);
    u.searchParams.set('limit', String(Math.min(cap, 100)));
    return u.toString();
  }

  // -------------------------------------------------------------------------
  // Fetchers
  // -------------------------------------------------------------------------

  private async fetchIssuesPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: IssuesPageItem[]; next: string | null }> {
    const url = page ?? this.buildInitialIssuesUrl(options);
    const res = await this.fetch<SentryIssue[]>(url, 'issues', signal);

    const nextLink = parseSentryLink(res.headers.get('link'), 'next');
    const next =
      nextLink && nextLink.hasResults
        ? this.sanitizePageUrl('issues', nextLink.url)
        : null;

    const eventsByIssue = new Map<string, SentryIssueEvent[]>();
    if (this.isResourceEnabled('issue_events')) {
      for (const issue of res.body) {
        signal?.throwIfAborted();
        const eventsRes = await this.fetch<SentryIssueEvent[]>(
          this.buildIssueEventsUrl(issue.id),
          'issue_events',
          signal,
        );
        eventsByIssue.set(issue.id, eventsRes.body);
      }
    }

    return { items: [{ issues: res.body, eventsByIssue }], next };
  }

  private async fetchReleasesPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: SentryRelease[]; next: string | null }> {
    const url = page ?? this.buildInitialReleasesUrl();
    const res = await this.fetch<SentryRelease[]>(url, 'releases', signal);
    const nextLink = parseSentryLink(res.headers.get('link'), 'next');
    const next =
      nextLink && nextLink.hasResults
        ? this.sanitizePageUrl('releases', nextLink.url)
        : null;
    return { items: res.body, next };
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

  // -------------------------------------------------------------------------
  // Writers
  // -------------------------------------------------------------------------

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
        await storage.entity({
          type: 'sentry_issue',
          id: issue.id,
          attributes: {
            shortId: issue.shortId,
            title: issue.title,
            level: issue.level,
            status: issue.status,
            firstSeen: new Date(issue.firstSeen).getTime(),
            lastSeen: new Date(issue.lastSeen).getTime(),
            count: Number.isFinite(count) ? count : 0,
            userCount: issue.userCount,
            projectSlug: issue.project.slug,
          },
          updated_at: new Date(issue.lastSeen).getTime(),
        });
      }

      if (writeEvents) {
        const events = item.eventsByIssue.get(issue.id) ?? [];
        for (const ev of events) {
          const eventId = ev.eventID ?? ev.id ?? null;
          if (eventId === null) {
            continue;
          }
          await storage.event({
            name: 'sentry_issue_event',
            start_ts: new Date(ev.dateCreated).getTime(),
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
      const createdMs = new Date(r.dateCreated).getTime();
      const releasedMs = r.dateReleased
        ? new Date(r.dateReleased).getTime()
        : null;
      const lastEventMs = r.lastEvent ? new Date(r.lastEvent).getTime() : null;
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
    for (const group of stats.groups) {
      const project = group.by['project'];
      const projectKey = project !== undefined ? String(project) : 'unknown';
      const series = group.series['sum(quantity)'] ?? [];
      for (let i = 0; i < stats.intervals.length; i++) {
        const intervalIso = stats.intervals[i];
        const rawValue = series[i];
        if (intervalIso === undefined || rawValue === undefined) {
          continue;
        }
        const ts = new Date(intervalIso).getTime();
        const value = Number(rawValue);
        if (!Number.isFinite(ts) || !Number.isFinite(value)) {
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

  // -------------------------------------------------------------------------
  // sync
  // -------------------------------------------------------------------------

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
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'issues':
            return this.fetchIssuesPage(page, options, sig);
          case 'releases':
            return this.fetchReleasesPage(page, sig);
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
