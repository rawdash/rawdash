import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
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
    watchedDomains: z.array(z.string().trim().min(1)).optional().meta({
      label: 'Watched domains',
      description:
        'Domains to watch for Hacker News submissions (e.g. "rawdash.dev"). Any story whose URL host matches one of these is tracked. At least one watched domain or watched query is required.',
      placeholder: 'rawdash.dev',
    }),
    watchedQueries: z.array(z.string().trim().min(1)).optional().meta({
      label: 'Watched queries',
      description:
        'Free-text terms to watch. Each term matches story titles/text (submissions) and comment bodies (mentions). At least one watched domain or watched query is required.',
      placeholder: 'rawdash',
    }),
    resources: z
      .array(z.enum(['submissions', 'submission_metrics', 'mentions']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which resources to sync. Omit to sync all. 'submission_metrics' rides the 'submissions' fetch - enabling it writes a daily points/comments snapshot per submission. 'mentions' requires at least one watched query.",
      }),
    lookbackDays: z.number().int().positive().max(365).optional().meta({
      label: 'Backfill lookback (days)',
      description:
        'How many days back to fetch submissions and mentions on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
    metricsRefreshDays: z.number().int().positive().max(365).optional().meta({
      label: 'Incremental refresh window (days)',
      description:
        'On an incremental sync, submissions created within this many days are re-fetched so their points/comments snapshot and current rank stay fresh. Defaults to 30.',
      placeholder: '30',
    }),
    pollIntervalMinutes: z.number().int().positive().max(1440).optional().meta({
      label: 'Poll interval (minutes)',
      description:
        'Scheduling hint for how often to sync. Defaults to 15; sync more aggressively while a submission is on the front page. Consumed by the scheduler, not the sync itself.',
      placeholder: '15',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Hacker News',
  category: 'marketing',
  brandColor: '#FF6600',
  tagline:
    'Watch Hacker News for submissions of your domain and mentions of your product in comments - points, comments, and current front-page rank.',
  vendor: {
    name: 'Hacker News',
    domain: 'news.ycombinator.com',
    apiDocs: 'https://hn.algolia.com/api',
    website: 'https://news.ycombinator.com',
  },
  auth: {
    summary:
      'None. Hacker News data is read through the public Algolia HN Search API, which needs no API key or account.',
    setup: [
      'Set `watchedDomains` to the domains you want to track submissions for (e.g. `["rawdash.dev"]`).',
      'Optionally set `watchedQueries` to product/brand terms to track story and comment mentions.',
      'No secret is required.',
    ],
  },
  rateLimit:
    'The Algolia HN Search API allows roughly 10,000 requests/hour per IP unauthenticated. This connector paginates sequentially at 100 hits per page and caps each search term at 20 pages.',
  limitations: [
    'Points and comment counts are point-in-time snapshots; Hacker News exposes no historical trajectory, so the metric history accumulates one daily sample per submission going forward from first sync.',
    'Current front-page rank is only available while a submission sits on the front page (top ~90); it is null otherwise.',
    'Comment mentions are matched by free-text query only - there is no per-domain comment search.',
  ],
});

export type HackerNewsResource =
  | 'submissions'
  | 'submission_metrics'
  | 'mentions';

export interface HackerNewsSettings {
  watchedDomains?: readonly string[];
  watchedQueries?: readonly string[];
  resources?: readonly HackerNewsResource[];
  lookbackDays?: number;
  metricsRefreshDays?: number;
  pollIntervalMinutes?: number;
}

const storyHitSchema = z.object({
  objectID: z.string().min(1),
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  points: z.number().nullable().optional(),
  num_comments: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_at_i: z.number().nullable().optional(),
});

const commentHitSchema = z.object({
  objectID: z.string().min(1),
  author: z.string().nullable().optional(),
  comment_text: z.string().nullable().optional(),
  story_id: z.number().nullable().optional(),
  story_title: z.string().nullable().optional(),
  story_url: z.string().nullable().optional(),
  parent_id: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_at_i: z.number().nullable().optional(),
});

const storySearchResponseSchema = z.object({
  hits: z.array(storyHitSchema),
  nbPages: z.number().int().nonnegative().optional(),
  page: z.number().int().nonnegative().optional(),
  nbHits: z.number().int().nonnegative().optional(),
});

const commentSearchResponseSchema = z.object({
  hits: z.array(commentHitSchema),
  nbPages: z.number().int().nonnegative().optional(),
  page: z.number().int().nonnegative().optional(),
  nbHits: z.number().int().nonnegative().optional(),
});

type StoryHit = z.infer<typeof storyHitSchema>;
type CommentHit = z.infer<typeof commentHitSchema>;
type SearchResponse<H> = {
  hits?: H[];
  nbPages?: number;
};

export const hackerNewsResources = defineResources({
  hn_submission: {
    shape: 'entity',
    filterable: [],
    description:
      'Hacker News story submissions matching a watched domain or query, with current points, comment count, author, and submission time.',
    endpoint: 'GET /api/v1/search_by_date?tags=story',
    notes:
      'Fetched newest-first from the Algolia HN Search API, bounded by the lookback window on full sync and the refresh window on incremental sync. Domain matches are confirmed against the parsed URL host.',
    fields: [
      { name: 'title', description: 'Submission title.' },
      { name: 'url', description: 'Submitted URL, or null for text posts.' },
      { name: 'author', description: 'Submitter username.' },
      { name: 'points', description: 'Current score at last sync.' },
      { name: 'comments', description: 'Current comment count at last sync.' },
      {
        name: 'createdAt',
        description: 'Submission time (epoch ms).',
      },
    ],
    responses: { stories: storySearchResponseSchema },
  },
  hn_submission_metric: {
    shape: 'metric',
    unit: 'points',
    granularity: 'day',
    description:
      'Daily snapshot of a watched submission: its score (value), comment count, and current front-page rank. One sample per submission per sync day.',
    endpoint: 'GET /api/v1/search_by_date?tags=story',
    notes:
      "The primary numeric (value) is the story score. Only today's samples are replaced on each sync, so prior days accumulate into a trajectory.",
    dimensions: [
      { name: 'submissionId', description: 'Hacker News story id.' },
      { name: 'title', description: 'Submission title.' },
      { name: 'url', description: 'Submitted URL, or null for text posts.' },
      { name: 'author', description: 'Submitter username.' },
    ],
    measures: [
      { name: 'comments', description: 'Comment count at snapshot time.' },
      {
        name: 'currentRank',
        description:
          'Front-page position (1-based) at snapshot time, or null if off the front page.',
      },
    ],
  },
  hn_mention: {
    shape: 'entity',
    filterable: [],
    description:
      'Hacker News comments whose text matches a watched query, linked to the story they were posted under.',
    endpoint: 'GET /api/v1/search_by_date?tags=comment',
    notes:
      'Requires at least one watched query; there is no domain-scoped comment search.',
    fields: [
      { name: 'author', description: 'Comment author username.' },
      { name: 'text', description: 'Comment body (HTML as returned).' },
      { name: 'storyId', description: 'Id of the story the comment is under.' },
      { name: 'storyTitle', description: 'Title of that story.' },
      { name: 'query', description: 'The watched query that matched.' },
      { name: 'createdAt', description: 'Comment time (epoch ms).' },
    ],
    responses: { comments: commentSearchResponseSchema },
  },
});

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';
const HITS_PER_PAGE = 100;
const MAX_PAGES_PER_TERM = 20;
const FRONT_PAGE_SIZE = 90;
const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_METRICS_REFRESH_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export const id = 'hacker-news';

function cleanList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values ?? []) {
    const trimmed = v.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
}

function hostMatchesDomain(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function isAbortError(signal: AbortSignal | undefined, err: unknown): boolean {
  return Boolean(
    signal?.aborted || (err instanceof Error && err.name === 'AbortError'),
  );
}

function storyCreatedAtMs(hit: StoryHit): number | null {
  if (
    typeof hit.created_at_i === 'number' &&
    Number.isFinite(hit.created_at_i)
  ) {
    return hit.created_at_i * 1000;
  }
  if (hit.created_at) {
    const ms = Date.parse(hit.created_at);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function commentCreatedAtMs(hit: CommentHit): number | null {
  if (
    typeof hit.created_at_i === 'number' &&
    Number.isFinite(hit.created_at_i)
  ) {
    return hit.created_at_i * 1000;
  }
  if (hit.created_at) {
    const ms = Date.parse(hit.created_at);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

interface StoryTerm {
  type: 'domain' | 'query';
  value: string;
}

export class HackerNewsConnector extends BaseConnector<
  HackerNewsSettings,
  Record<string, never>
> {
  static readonly id = id;

  static readonly resources = hackerNewsResources;

  static readonly schemas = schemasFromResources(hackerNewsResources);

  static create(input: unknown, ctx?: ConnectorContext): HackerNewsConnector {
    const parsed = configFields.parse(input);
    return new HackerNewsConnector(
      parsed as HackerNewsSettings,
      undefined,
      ctx,
    );
  }

  readonly id = id;

  private frontPageRanks: Map<string, number> | null = null;

  private headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('hacker-news'),
    };
  }

  private sinceSeconds(options: SyncOptions, now: number): number {
    if (options.mode !== 'full' && options.since) {
      const ms = parseEpoch(options.since, 'iso');
      if (ms !== null) {
        return Math.floor(ms / 1000);
      }
    }
    const days =
      options.mode === 'full'
        ? (this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS)
        : (this.settings.metricsRefreshDays ?? DEFAULT_METRICS_REFRESH_DAYS);
    return Math.floor((now - days * MS_PER_DAY) / 1000);
  }

  private async searchStories(
    term: StoryTerm,
    sinceSec: number,
    page: number,
    signal: AbortSignal | undefined,
  ): Promise<SearchResponse<StoryHit>> {
    const url = new URL(`${ALGOLIA_BASE}/search_by_date`);
    url.searchParams.set('tags', 'story');
    url.searchParams.set('query', term.value);
    url.searchParams.set('hitsPerPage', String(HITS_PER_PAGE));
    url.searchParams.set('page', String(page));
    url.searchParams.set('numericFilters', `created_at_i>=${sinceSec}`);
    if (term.type === 'domain') {
      url.searchParams.set('restrictSearchableAttributes', 'url');
    }
    const res = await this.get<SearchResponse<StoryHit>>(url.toString(), {
      resource: 'submissions',
      headers: this.headers(),
      signal,
    });
    return res.body ?? { hits: [] };
  }

  private async searchComments(
    query: string,
    sinceSec: number,
    page: number,
    signal: AbortSignal | undefined,
  ): Promise<SearchResponse<CommentHit>> {
    const url = new URL(`${ALGOLIA_BASE}/search_by_date`);
    url.searchParams.set('tags', 'comment');
    url.searchParams.set('query', query);
    url.searchParams.set('hitsPerPage', String(HITS_PER_PAGE));
    url.searchParams.set('page', String(page));
    url.searchParams.set('numericFilters', `created_at_i>=${sinceSec}`);
    const res = await this.get<SearchResponse<CommentHit>>(url.toString(), {
      resource: 'mentions',
      headers: this.headers(),
      signal,
    });
    return res.body ?? { hits: [] };
  }

  private async collectStories(
    terms: StoryTerm[],
    sinceSec: number,
    signal: AbortSignal | undefined,
  ): Promise<StoryHit[]> {
    const byId = new Map<string, StoryHit>();
    for (const term of terms) {
      let page = 0;
      for (;;) {
        signal?.throwIfAborted();
        const body = await this.searchStories(term, sinceSec, page, signal);
        const hits = body.hits ?? [];
        for (const hit of hits) {
          if (
            term.type === 'domain' &&
            !(hit.url && hostMatchesDomain(hit.url, term.value))
          ) {
            continue;
          }
          if (!byId.has(hit.objectID)) {
            byId.set(hit.objectID, hit);
          }
        }
        const nbPages = body.nbPages ?? 1;
        page += 1;
        if (
          page >= nbPages ||
          page >= MAX_PAGES_PER_TERM ||
          hits.length === 0
        ) {
          break;
        }
      }
    }
    return [...byId.values()];
  }

  private async collectComments(
    queries: string[],
    sinceSec: number,
    signal: AbortSignal | undefined,
  ): Promise<Array<{ hit: CommentHit; query: string }>> {
    const byId = new Map<string, { hit: CommentHit; query: string }>();
    for (const query of queries) {
      let page = 0;
      for (;;) {
        signal?.throwIfAborted();
        const body = await this.searchComments(query, sinceSec, page, signal);
        const hits = body.hits ?? [];
        for (const hit of hits) {
          if (!byId.has(hit.objectID)) {
            byId.set(hit.objectID, { hit, query });
          }
        }
        const nbPages = body.nbPages ?? 1;
        page += 1;
        if (
          page >= nbPages ||
          page >= MAX_PAGES_PER_TERM ||
          hits.length === 0
        ) {
          break;
        }
      }
    }
    return [...byId.values()];
  }

  private async getFrontPageRanks(
    signal: AbortSignal | undefined,
  ): Promise<Map<string, number>> {
    if (this.frontPageRanks) {
      return this.frontPageRanks;
    }
    const ranks = new Map<string, number>();
    try {
      const url = new URL(`${ALGOLIA_BASE}/search`);
      url.searchParams.set('tags', 'front_page');
      url.searchParams.set('hitsPerPage', String(FRONT_PAGE_SIZE));
      const res = await this.get<SearchResponse<StoryHit>>(url.toString(), {
        resource: 'submission_metrics',
        headers: this.headers(),
        signal,
      });
      const hits = res.body?.hits ?? [];
      hits.forEach((hit, index) => {
        ranks.set(hit.objectID, index + 1);
      });
    } catch (err) {
      if (isAbortError(signal, err)) {
        throw err;
      }
      this.logger.warn('front-page rank fetch failed', {
        resource: 'submission_metrics',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.frontPageRanks = ranks;
    return ranks;
  }

  private submissionEntity(hit: StoryHit, now: number): Entity {
    return {
      type: 'hn_submission',
      id: hit.objectID,
      attributes: {
        title: hit.title ?? null,
        url: hit.url ?? null,
        author: hit.author ?? null,
        points: hit.points ?? 0,
        comments: hit.num_comments ?? 0,
        createdAt: storyCreatedAtMs(hit),
      },
      updated_at: now,
    };
  }

  private submissionMetricSample(
    hit: StoryHit,
    dayStart: number,
    ranks: Map<string, number>,
  ): MetricSample {
    return {
      name: 'hn_submission_metric',
      ts: dayStart,
      value: hit.points ?? 0,
      attributes: {
        submissionId: hit.objectID,
        title: hit.title ?? null,
        url: hit.url ?? null,
        author: hit.author ?? null,
        comments: hit.num_comments ?? 0,
        currentRank: ranks.get(hit.objectID) ?? null,
      },
    };
  }

  private mentionEntity(hit: CommentHit, query: string, now: number): Entity {
    const attributes: Record<string, JSONValue> = {
      author: hit.author ?? null,
      text: hit.comment_text ?? null,
      storyId: hit.story_id != null ? String(hit.story_id) : null,
      storyTitle: hit.story_title ?? null,
      storyUrl: hit.story_url ?? null,
      parentId: hit.parent_id != null ? String(hit.parent_id) : null,
      query,
      createdAt: commentCreatedAtMs(hit),
    };
    return {
      type: 'hn_mention',
      id: hit.objectID,
      attributes,
      updated_at: commentCreatedAtMs(hit) ?? now,
    };
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const now = Date.now();
    const isFull = options.mode === 'full';
    const domains = cleanList(this.settings.watchedDomains).map(
      normalizeDomain,
    );
    const queries = cleanList(this.settings.watchedQueries);

    if (domains.length === 0 && queries.length === 0) {
      this.logger.warn(
        'no watched domains or queries configured; nothing to sync',
      );
      return { done: true };
    }

    const wantSubmissions = this.isResourceEnabled('submissions');
    const wantMetrics = this.isResourceEnabled('submission_metrics');
    const wantMentions = this.isResourceEnabled('mentions');

    try {
      if (wantSubmissions || wantMetrics) {
        const sinceSec = this.sinceSeconds(options, now);
        const storyTerms: StoryTerm[] = [
          ...domains.map((value) => ({ type: 'domain' as const, value })),
          ...queries.map((value) => ({ type: 'query' as const, value })),
        ];
        const stories = await this.collectStories(storyTerms, sinceSec, signal);

        if (wantSubmissions) {
          if (isFull) {
            await storage.entities([], { types: ['hn_submission'] });
          }
          for (const hit of stories) {
            await storage.entity(this.submissionEntity(hit, now));
          }
        }

        if (wantMetrics && stories.length > 0) {
          const ranks = await this.getFrontPageRanks(signal);
          const dayStart = Math.floor(now / MS_PER_DAY) * MS_PER_DAY;
          const samples = stories.map((hit) =>
            this.submissionMetricSample(hit, dayStart, ranks),
          );
          await storage.metrics(samples, {
            names: ['hn_submission_metric'],
            replaceWindow: { start: dayStart, end: dayStart + MS_PER_DAY - 1 },
          });
        }
      }

      if (wantMentions && queries.length > 0) {
        const sinceSec = this.sinceSeconds(options, now);
        const mentions = await this.collectComments(queries, sinceSec, signal);
        if (isFull) {
          await storage.entities([], { types: ['hn_mention'] });
        }
        for (const { hit, query } of mentions) {
          await storage.entity(this.mentionEntity(hit, query, now));
        }
      }
    } catch (err) {
      if (isAbortError(signal, err)) {
        return { done: false };
      }
      throw err;
    }

    return { done: true };
  }
}
