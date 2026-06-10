import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type FetchPageResult,
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

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

const repoSlug = z
  .string()
  .min(1)
  .regex(
    /^[^/\s?#]+$/,
    'Use the repository slug only (no workspace prefix, slashes, or query).',
  );

export const configFields = defineConfigFields(
  z.object({
    workspace: z
      .string()
      .min(1)
      .regex(
        /^[^/\s?#]+$/,
        'Use the workspace slug only (no slashes, spaces, or query).',
      )
      .meta({
        label: 'Workspace',
        description:
          'Bitbucket Cloud workspace slug (the segment shown in repo URLs after bitbucket.org/).',
        placeholder: 'my-workspace',
      }),
    username: z.string().min(1).meta({
      label: 'Atlassian username',
      description:
        'Atlassian account username paired with the app password for Basic auth (find it under Personal settings -> Account settings).',
      placeholder: 'janedoe',
    }),
    appPassword: z.object({ $secret: z.string() }).meta({
      label: 'App password',
      description:
        'Bitbucket app password with `Repositories:Read` and `Pipelines:Read` scopes. Create one at Personal settings -> App passwords.',
      placeholder: 'ATBB...',
      secret: true,
    }),
    repoSlugs: z
      .array(repoSlug)
      .nonempty()
      .refine((slugs) => new Set(slugs).size === slugs.length, {
        error: 'Repository slugs must be unique.',
      })
      .meta({
        label: 'Repository slugs',
        description:
          'Repositories to sync, named by their slug within the workspace (no `workspace/` prefix).',
      }),
    resources: z
      .array(z.enum(['pull_request', 'pipeline', 'pipeline_event']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          "Which Bitbucket resources to sync. Omit to sync all of them. 'pipeline_event' rides the 'pipeline' phase - enabling it without 'pipeline' still fetches pipelines but skips writing pipeline entities.",
      }),
  }),
);

// ---------------------------------------------------------------------------
// Connector documentation metadata
// ---------------------------------------------------------------------------

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Bitbucket',
  category: 'engineering',
  brandColor: '#0052CC',
  tagline:
    'Sync pull requests, pipelines, and pipeline lifecycle events from Bitbucket Cloud repositories.',
  vendor: {
    name: 'Atlassian',
    domain: 'bitbucket.org',
    apiDocs: 'https://developer.atlassian.com/cloud/bitbucket/rest/intro/',
    website: 'https://bitbucket.org',
  },
  auth: {
    summary:
      'Authenticates over HTTP Basic auth using an Atlassian account username and a Bitbucket app password. The password is scoped to the projects and repositories the account can already read.',
    setup: [
      'Open Bitbucket -> Personal settings -> App passwords (https://bitbucket.org/account/settings/app-passwords/).',
      'Create an app password with `Repositories:Read` and `Pipelines:Read` scopes.',
      'Store it as a secret and reference it from the connector config as `appPassword: secret("BITBUCKET_APP_PASSWORD")`, alongside your `workspace`, `username`, and the list of `repoSlugs` to sync.',
    ],
  },
  rateLimit:
    'Bitbucket Cloud applies hourly per-IP and per-user limits (around 1,000 requests/hour for app-password auth). Pagination uses a `next` URL in each response and a configurable `pagelen` (capped at 50 here).',
  limitations: [
    'Bitbucket Server / Data Center are out of scope; this connector targets Bitbucket Cloud only.',
    'Pipeline state-transition events are synthesized: one `pipeline_event` is emitted per pipeline lifecycle (created_on to completed_on/updated_on), not one per intermediate state change.',
    'Repository discovery is not automatic - configure each repository slug explicitly via `repoSlugs`.',
  ],
});

// ---------------------------------------------------------------------------
// Settings and credentials
// ---------------------------------------------------------------------------

export type BitbucketResource = 'pull_request' | 'pipeline' | 'pipeline_event';

export interface BitbucketSettings {
  workspace: string;
  repoSlugs: readonly string[];
  resources?: readonly BitbucketResource[];
}

const bitbucketCredentials = {
  username: {
    description: 'Atlassian account username',
    auth: 'required' as const,
  },
  appPassword: {
    description: 'Bitbucket app password',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type BitbucketCredentials = typeof bitbucketCredentials;

const API_HOST = 'api.bitbucket.org';
const API_BASE = `https://${API_HOST}`;
const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = ['pull_requests', 'pipelines'] as const;

type BitbucketPhase = (typeof PHASE_ORDER)[number];

type BitbucketSyncCursor = ChunkedSyncCursor<BitbucketPhase, string>;

const isBitbucketSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

// Page-cursor encoding: `<repoIdx>|<pageUrl?>`.
// - null page          -> start at repoIdx=0 with no URL yet
// - "<idx>|"           -> start of repo at idx, build initial URL
// - "<idx>|<url>"      -> continuing pagination for repo at idx
function decodePage(page: string | null): {
  idx: number;
  url: string | null;
} {
  if (page === null) {
    return { idx: 0, url: null };
  }
  const sep = page.indexOf('|');
  if (sep === -1) {
    return { idx: 0, url: null };
  }
  const idxRaw = Number.parseInt(page.slice(0, sep), 10);
  const url = page.slice(sep + 1);
  return {
    idx: Number.isFinite(idxRaw) && idxRaw >= 0 ? idxRaw : 0,
    url: url === '' ? null : url,
  };
}

function encodePage(idx: number, url: string | null): string {
  return `${idx}|${url ?? ''}`;
}

// ---------------------------------------------------------------------------
// Bitbucket API types
// ---------------------------------------------------------------------------

interface BitbucketAccountRef {
  uuid?: string | null;
  display_name?: string | null;
  nickname?: string | null;
  account_id?: string | null;
}

interface BitbucketBranchRef {
  branch?: { name?: string | null } | null;
  commit?: { hash?: string | null } | null;
}

interface BitbucketPullRequest {
  id: number;
  title: string;
  state: string;
  author?: BitbucketAccountRef | null;
  source?: BitbucketBranchRef | null;
  destination?: BitbucketBranchRef | null;
  created_on: string;
  updated_on: string;
  closed_on?: string | null;
  links?: { html?: { href?: string | null } | null } | null;
}

interface BitbucketPullRequestsResponse {
  values: BitbucketPullRequest[];
  next?: string | null;
  page?: number | null;
  pagelen?: number | null;
}

interface BitbucketPipelineTarget {
  ref_name?: string | null;
  commit?: { hash?: string | null } | null;
  selector?: { type?: string | null; pattern?: string | null } | null;
}

interface BitbucketPipelineState {
  name: string;
  type?: string | null;
  result?: { name?: string | null } | null;
}

interface BitbucketPipeline {
  uuid: string;
  build_number: number;
  state: BitbucketPipelineState;
  creator?: BitbucketAccountRef | null;
  target?: BitbucketPipelineTarget | null;
  trigger?: { name?: string | null; type?: string | null } | null;
  created_on: string;
  completed_on?: string | null;
  duration_in_seconds?: number | null;
  build_seconds_used?: number | null;
}

interface BitbucketPipelinesResponse {
  values: BitbucketPipeline[];
  next?: string | null;
  page?: number | null;
  pagelen?: number | null;
}

// ---------------------------------------------------------------------------
// Zod response schemas
// ---------------------------------------------------------------------------

const accountRefSchema = z.object({
  uuid: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  nickname: z.string().nullable().optional(),
  account_id: z.string().nullable().optional(),
});

const branchRefSchema = z.object({
  branch: z
    .object({ name: z.string().nullable().optional() })
    .nullable()
    .optional(),
  commit: z
    .object({ hash: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

const pullRequestSchema = z.object({
  id: z.number().int().nonnegative(),
  title: z.string(),
  state: z.string().min(1),
  author: accountRefSchema.nullable().optional(),
  source: branchRefSchema.nullable().optional(),
  destination: branchRefSchema.nullable().optional(),
  created_on: z.iso.datetime(),
  updated_on: z.iso.datetime(),
  closed_on: z.iso.datetime().nullable().optional(),
  links: z
    .object({
      html: z
        .object({ href: z.string().nullable().optional() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

const pullRequestsResponseSchema = z.object({
  values: z.array(pullRequestSchema),
  next: z.string().nullable().optional(),
  page: z.number().int().nullable().optional(),
  pagelen: z.number().int().nullable().optional(),
});

const pipelineStateSchema = z.object({
  name: z.string().min(1),
  type: z.string().nullable().optional(),
  result: z
    .object({ name: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

const pipelineTargetSchema = z.object({
  ref_name: z.string().nullable().optional(),
  commit: z
    .object({ hash: z.string().nullable().optional() })
    .nullable()
    .optional(),
  selector: z
    .object({
      type: z.string().nullable().optional(),
      pattern: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const pipelineSchema = z.object({
  uuid: z.string().min(1),
  build_number: z.number().int().nonnegative(),
  state: pipelineStateSchema,
  creator: accountRefSchema.nullable().optional(),
  target: pipelineTargetSchema.nullable().optional(),
  trigger: z
    .object({
      name: z.string().nullable().optional(),
      type: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  created_on: z.iso.datetime(),
  completed_on: z.iso.datetime().nullable().optional(),
  duration_in_seconds: z.number().nullable().optional(),
  build_seconds_used: z.number().nullable().optional(),
});

const pipelinesResponseSchema = z.object({
  values: z.array(pipelineSchema),
  next: z.string().nullable().optional(),
  page: z.number().int().nullable().optional(),
  pagelen: z.number().int().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Resource definitions
// ---------------------------------------------------------------------------

export const bitbucketResources = defineResources({
  pull_request: {
    shape: 'entity',
    description:
      'Open, merged, declined, and superseded pull requests with author, source/target branches, and close timestamp.',
    endpoint:
      'GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests?state=OPEN,MERGED,DECLINED,SUPERSEDED',
    notes:
      'Paginated newest-first by `updated_on`; the connector stops once a page is entirely older than `options.since`.',
    responses: { pull_requests: pullRequestsResponseSchema },
  },
  pipeline: {
    shape: 'entity',
    description:
      'Bitbucket Pipelines runs with state, result, target ref/commit, trigger, duration, and create/complete timestamps.',
    endpoint: 'GET /2.0/repositories/{workspace}/{repo_slug}/pipelines/',
    notes:
      'Paginated newest-first by `created_on`; the connector stops once a page is entirely older than `options.since`.',
    responses: { pipelines: pipelinesResponseSchema },
  },
  pipeline_event: {
    shape: 'event',
    description:
      'Pipeline lifecycle events. One event per pipeline covering created_on to completed_on (or updated_on if not yet finished), tagged with the terminal state and result.',
    endpoint: 'GET /2.0/repositories/{workspace}/{repo_slug}/pipelines/',
    notes:
      'Derived from the same pipelines response that builds the `pipeline` resource; the Bitbucket API does not expose an intermediate state-transition history endpoint.',
  },
});

export const id = 'bitbucket';

// ---------------------------------------------------------------------------
// Connector class
// ---------------------------------------------------------------------------

interface RepoBatch<T> {
  repoSlug: string;
  items: T[];
}

export class BitbucketConnector extends BaseConnector<
  BitbucketSettings,
  BitbucketCredentials
> {
  static readonly id = id;

  static readonly resources = bitbucketResources;

  static readonly schemas = schemasFromResources(bitbucketResources);

  static create(input: unknown, ctx?: ConnectorContext): BitbucketConnector {
    const parsed = configFields.parse(input);
    return new BitbucketConnector(
      {
        workspace: parsed.workspace,
        repoSlugs: parsed.repoSlugs,
        resources: parsed.resources,
      },
      { username: parsed.username, appPassword: parsed.appPassword },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = bitbucketCredentials;

  private buildHeaders(): Record<string, string> {
    const basic = btoa(`${this.creds.username}:${this.creds.appPassword}`);
    return {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('bitbucket'),
    };
  }

  private fetch<T>(
    url: string,
    resource: string,
    signal: AbortSignal | undefined,
  ): Promise<HttpResponse<T>> {
    return this.get<T>(url, {
      resource,
      headers: this.buildHeaders(),
      signal,
    });
  }

  private sanitizeUrl(url: string | null, expectedPath: string): string | null {
    if (!url) {
      return null;
    }
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.host !== API_HOST) {
        return null;
      }
      if (u.pathname !== expectedPath) {
        return null;
      }
      return u.toString();
    } catch {
      return null;
    }
  }

  private static readonly PHASE_RESOURCES: Record<
    BitbucketPhase,
    readonly BitbucketResource[]
  > = {
    pull_requests: ['pull_request'],
    pipelines: ['pipeline', 'pipeline_event'],
  };

  private activePhases(
    optionsResources: ReadonlySet<string> | undefined,
  ): BitbucketPhase[] {
    const fromSettings = selectActivePhases<BitbucketResource, BitbucketPhase>(
      (r) => {
        switch (r) {
          case 'pull_request':
            return 'pull_requests';
          case 'pipeline':
          case 'pipeline_event':
            return 'pipelines';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
    if (optionsResources === undefined) {
      return fromSettings;
    }
    return fromSettings.filter((phase) =>
      BitbucketConnector.PHASE_RESOURCES[phase].some((r) =>
        optionsResources.has(r),
      ),
    );
  }

  private isResourceAllowed(
    resource: BitbucketResource,
    optionsResources: ReadonlySet<string> | undefined,
  ): boolean {
    const fromSettings = this.settings.resources;
    if (
      fromSettings &&
      fromSettings.length > 0 &&
      !fromSettings.includes(resource)
    ) {
      return false;
    }
    if (optionsResources !== undefined && !optionsResources.has(resource)) {
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // URL builders
  // -------------------------------------------------------------------------

  private buildPullRequestsUrl(
    repoSlugValue: string,
    options: SyncOptions,
  ): string {
    const u = new URL(
      `${API_BASE}/2.0/repositories/${encodeURIComponent(this.settings.workspace)}/${encodeURIComponent(repoSlugValue)}/pullrequests`,
    );
    u.searchParams.set('pagelen', String(PAGE_SIZE));
    u.searchParams.set('sort', '-updated_on');
    u.searchParams.set('state', 'OPEN,MERGED,DECLINED,SUPERSEDED');
    if (options.since) {
      u.searchParams.set('q', `updated_on >= ${options.since}`);
    }
    return u.toString();
  }

  private buildPipelinesUrl(
    repoSlugValue: string,
    options: SyncOptions,
  ): string {
    const u = new URL(
      `${API_BASE}/2.0/repositories/${encodeURIComponent(this.settings.workspace)}/${encodeURIComponent(repoSlugValue)}/pipelines/`,
    );
    u.searchParams.set('pagelen', String(PAGE_SIZE));
    u.searchParams.set('sort', '-created_on');
    if (options.since) {
      u.searchParams.set('q', `created_on >= ${options.since}`);
    }
    return u.toString();
  }

  private pullRequestsPath(repoSlugValue: string): string {
    return `/2.0/repositories/${this.settings.workspace}/${repoSlugValue}/pullrequests`;
  }

  private pipelinesPath(repoSlugValue: string): string {
    return `/2.0/repositories/${this.settings.workspace}/${repoSlugValue}/pipelines/`;
  }

  // -------------------------------------------------------------------------
  // Fetchers
  // -------------------------------------------------------------------------

  private async fetchPullRequestsPage(
    options: SyncOptions,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const repos = this.settings.repoSlugs;
    if (repos.length === 0) {
      return { items: [], next: null };
    }
    const { idx, url: rawPageUrl } = decodePage(page);
    if (idx >= repos.length) {
      return { items: [], next: null };
    }
    const slug = repos[idx]!;
    const expectedPath = this.pullRequestsPath(slug);
    const fetchUrl =
      this.sanitizeUrl(rawPageUrl, expectedPath) ??
      this.buildPullRequestsUrl(slug, options);
    const res = await this.fetch<BitbucketPullRequestsResponse>(
      fetchUrl,
      'pull_requests',
      signal,
    );
    const rows = res.body.values;
    const cutoff = options.since ? parseEpoch(options.since, 'iso') : null;
    let filtered: BitbucketPullRequest[];
    let cutoffReached: boolean;
    if (cutoff !== null) {
      filtered = rows.filter((pr) => {
        const ts = parseEpoch(pr.updated_on, 'iso');
        return ts === null || ts >= cutoff;
      });
      const last = rows.at(-1);
      const lastTs = last ? parseEpoch(last.updated_on, 'iso') : null;
      cutoffReached = lastTs !== null && lastTs < cutoff;
    } else {
      filtered = rows;
      cutoffReached = false;
    }
    const safeNext = this.sanitizeUrl(res.body.next ?? null, expectedPath);
    const nextWithinRepo = cutoffReached ? null : safeNext;
    const batch: RepoBatch<BitbucketPullRequest> = {
      repoSlug: slug,
      items: filtered,
    };
    if (nextWithinRepo !== null) {
      return { items: [batch], next: encodePage(idx, nextWithinRepo) };
    }
    const nextIdx = idx + 1;
    const next = nextIdx < repos.length ? encodePage(nextIdx, null) : null;
    return { items: [batch], next };
  }

  private async fetchPipelinesPage(
    options: SyncOptions,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const repos = this.settings.repoSlugs;
    if (repos.length === 0) {
      return { items: [], next: null };
    }
    const { idx, url: rawPageUrl } = decodePage(page);
    if (idx >= repos.length) {
      return { items: [], next: null };
    }
    const slug = repos[idx]!;
    const expectedPath = this.pipelinesPath(slug);
    const fetchUrl =
      this.sanitizeUrl(rawPageUrl, expectedPath) ??
      this.buildPipelinesUrl(slug, options);
    const res = await this.fetch<BitbucketPipelinesResponse>(
      fetchUrl,
      'pipelines',
      signal,
    );
    const rows = res.body.values;
    const cutoff = options.since ? parseEpoch(options.since, 'iso') : null;
    let filtered: BitbucketPipeline[];
    let cutoffReached: boolean;
    if (cutoff !== null) {
      filtered = rows.filter((p) => {
        const ts = parseEpoch(p.created_on, 'iso');
        return ts === null || ts >= cutoff;
      });
      const last = rows.at(-1);
      const lastTs = last ? parseEpoch(last.created_on, 'iso') : null;
      cutoffReached = lastTs !== null && lastTs < cutoff;
    } else {
      filtered = rows;
      cutoffReached = false;
    }
    const safeNext = this.sanitizeUrl(res.body.next ?? null, expectedPath);
    const nextWithinRepo = cutoffReached ? null : safeNext;
    const batch: RepoBatch<BitbucketPipeline> = {
      repoSlug: slug,
      items: filtered,
    };
    if (nextWithinRepo !== null) {
      return { items: [batch], next: encodePage(idx, nextWithinRepo) };
    }
    const nextIdx = idx + 1;
    const next = nextIdx < repos.length ? encodePage(nextIdx, null) : null;
    return { items: [batch], next };
  }

  // -------------------------------------------------------------------------
  // Writers
  // -------------------------------------------------------------------------

  private async writePullRequests(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
    options: SyncOptions,
  ): Promise<void> {
    if (page === null && !options.since) {
      await storage.entities([], { types: ['pull_request'] });
    }
    const batches = items as RepoBatch<BitbucketPullRequest>[];
    for (const batch of batches) {
      for (const pr of batch.items) {
        const createdMs = parseEpoch(pr.created_on, 'iso');
        const updatedMs = parseEpoch(pr.updated_on, 'iso');
        if (createdMs === null || updatedMs === null) {
          continue;
        }
        await storage.entity({
          type: 'pull_request',
          id: `${this.settings.workspace}/${batch.repoSlug}:${pr.id}`,
          attributes: {
            workspace: this.settings.workspace,
            repo_slug: batch.repoSlug,
            pull_request_id: pr.id,
            title: pr.title,
            state: pr.state,
            author: pr.author?.nickname ?? pr.author?.display_name ?? null,
            source_branch: pr.source?.branch?.name ?? null,
            destination_branch: pr.destination?.branch?.name ?? null,
            web_url: pr.links?.html?.href ?? null,
            created_at: createdMs,
            closed_at: parseEpoch(pr.closed_on ?? null, 'iso'),
          },
          updated_at: updatedMs,
        });
      }
    }
  }

  private async writePipelines(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
    options: SyncOptions,
    seenPipelineIds: Set<string>,
  ): Promise<void> {
    const pipelineAllowed = this.isResourceAllowed(
      'pipeline',
      options.resources,
    );
    const eventAllowed = this.isResourceAllowed(
      'pipeline_event',
      options.resources,
    );
    if (page === null && !options.since) {
      if (pipelineAllowed) {
        await storage.entities([], { types: ['pipeline'] });
      }
      if (eventAllowed) {
        await storage.events([], { names: ['pipeline_event'] });
      }
    }
    const batches = items as RepoBatch<BitbucketPipeline>[];
    for (const batch of batches) {
      for (const pipeline of batch.items) {
        const createdMs = parseEpoch(pipeline.created_on, 'iso');
        if (createdMs === null) {
          continue;
        }
        const entityId = `${this.settings.workspace}/${batch.repoSlug}:${pipeline.uuid}`;
        if (seenPipelineIds.has(entityId)) {
          continue;
        }
        seenPipelineIds.add(entityId);
        const completedMs = parseEpoch(pipeline.completed_on ?? null, 'iso');
        const durationMs =
          pipeline.duration_in_seconds !== null &&
          pipeline.duration_in_seconds !== undefined
            ? Math.round(pipeline.duration_in_seconds * 1000)
            : completedMs !== null
              ? completedMs - createdMs
              : null;
        const result = pipeline.state.result?.name ?? null;
        const refName = pipeline.target?.ref_name ?? null;
        const commitHash = pipeline.target?.commit?.hash ?? null;
        const triggerType = pipeline.trigger?.type ?? null;
        if (pipelineAllowed) {
          await storage.entity({
            type: 'pipeline',
            id: entityId,
            attributes: {
              workspace: this.settings.workspace,
              repo_slug: batch.repoSlug,
              uuid: pipeline.uuid,
              build_number: pipeline.build_number,
              state: pipeline.state.name,
              result,
              ref_name: refName,
              commit: commitHash,
              trigger_type: triggerType,
              creator:
                pipeline.creator?.nickname ??
                pipeline.creator?.display_name ??
                null,
              created_at: createdMs,
              completed_at: completedMs,
              duration_ms: durationMs,
            },
            updated_at: completedMs ?? createdMs,
          });
        }
        if (eventAllowed) {
          await storage.event({
            name: 'pipeline_event',
            start_ts: createdMs,
            end_ts: completedMs,
            attributes: {
              workspace: this.settings.workspace,
              repo_slug: batch.repoSlug,
              uuid: pipeline.uuid,
              build_number: pipeline.build_number,
              state: pipeline.state.name,
              result,
              ref_name: refName,
              commit: commitHash,
              trigger_type: triggerType,
              duration_ms: durationMs,
            },
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Cursor resume
  // -------------------------------------------------------------------------

  private resolveCursor(cursor: unknown): BitbucketSyncCursor | undefined {
    if (!isBitbucketSyncCursor(cursor)) {
      return undefined;
    }
    return { phase: cursor.phase, page: cursor.page };
  }

  // -------------------------------------------------------------------------
  // sync()
  // -------------------------------------------------------------------------

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const phases = this.activePhases(options.resources);
    const seenPipelineIds = new Set<string>();
    return paginateChunked<BitbucketPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'pull_requests':
            return this.fetchPullRequestsPage(options, page, sig);
          case 'pipelines':
            return this.fetchPipelinesPage(options, page, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        switch (phase) {
          case 'pull_requests':
            return this.writePullRequests(storage, items, page, options);
          case 'pipelines':
            return this.writePipelines(
              storage,
              items,
              page,
              options,
              seenPipelineIds,
            );
        }
      },
    });
  }
}
