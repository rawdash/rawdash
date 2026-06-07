import {
  type HttpResponse,
  connectorUserAgent,
  parseLinkHeader,
  standardRateLimitPolicy,
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

const positiveInt = z.number().int().positive();

export const configFields = defineConfigFields(
  z
    .object({
      apiToken: z.object({ $secret: z.string() }).meta({
        label: 'API Token',
        description:
          'GitLab Personal Access Token with `read_api` scope. Create one at GitLab -> Preferences -> Access Tokens.',
        placeholder: 'glpat-...',
        secret: true,
      }),
      host: z
        .string()
        .min(1)
        .regex(
          /^[^/\s:?#]+$/,
          'Use host only (no protocol, port, path, or query).',
        )
        .optional()
        .meta({
          label: 'Host (optional)',
          description:
            'Your GitLab host. Defaults to `gitlab.com`. For self-hosted, supply the hostname only (e.g. `gitlab.example.com`).',
          placeholder: 'gitlab.com',
        }),
      projectIds: z.array(positiveInt).nonempty().optional().meta({
        label: 'Project IDs (optional)',
        description:
          'Numeric project IDs to sync directly (find one in Project -> Settings -> General). Combined with any projects discovered via `groupIds`.',
      }),
      groupIds: z.array(positiveInt).nonempty().optional().meta({
        label: 'Group IDs (optional)',
        description:
          'Numeric group IDs whose projects (including subgroups) will be discovered and synced.',
      }),
      resources: z
        .array(
          z.enum([
            'project',
            'merge_request',
            'pipeline',
            'pipeline_event',
            'issue',
            'release',
          ]),
        )
        .nonempty()
        .optional()
        .meta({
          label: 'Resources',
          description:
            "Which GitLab resources to sync. Omit to sync all of them. 'pipeline_event' rides the 'pipeline' phase - enabling it without 'pipeline' still fetches pipelines but skips writing pipeline entities.",
        }),
    })
    .refine(
      (v) =>
        (v.projectIds && v.projectIds.length > 0) ||
        (v.groupIds && v.groupIds.length > 0),
      {
        message: 'At least one of `projectIds` or `groupIds` must be provided.',
        path: ['projectIds'],
      },
    ),
);

// ---------------------------------------------------------------------------
// Connector documentation metadata
// ---------------------------------------------------------------------------

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'GitLab',
  category: 'engineering',
  brandColor: '#FC6D26',
  tagline:
    'Sync projects, merge requests, pipelines, issues, and releases from GitLab.com or a self-hosted GitLab instance.',
  vendor: {
    name: 'GitLab',
    apiDocs: 'https://docs.gitlab.com/ee/api/',
    website: 'https://gitlab.com',
  },
  auth: {
    summary:
      'A GitLab Personal Access Token (PAT) with the `read_api` scope is required. The PAT must belong to an account with read access to the projects and groups you want to sync. Self-hosted GitLab is supported by overriding the `host` field.',
    setup: [
      'Open GitLab -> User Preferences -> Access Tokens (or the equivalent on your self-hosted instance).',
      'Create a Personal Access Token with the `read_api` scope.',
      'Store it as a secret and reference it from the connector config as `apiToken: secret("GITLAB_API_TOKEN")`.',
      'Set `projectIds` to a list of numeric project IDs, or `groupIds` to a list of numeric group IDs (or both). At least one must be set.',
      'For self-hosted GitLab, set `host` to your instance hostname (no protocol or path), e.g. `gitlab.example.com`.',
    ],
  },
  rateLimit:
    'GitLab returns standard `RateLimit-Remaining` / `RateLimit-Reset` headers (reset is a Unix timestamp in seconds); list pagination uses the Link header (page size 100).',
  limitations: [
    'Container Registry, Packages, and GitLab Duo / AI features are out of scope.',
    'Pipeline state-transition events are synthesized: one `pipeline_event` is emitted per pipeline lifecycle (created_at to finished_at/updated_at), not one per intermediate state change.',
    'Group project discovery walks each group with `include_subgroups=true`; very large groups may take multiple sync chunks to enumerate.',
  ],
});

// ---------------------------------------------------------------------------
// Settings and credentials
// ---------------------------------------------------------------------------

export type GitLabResource =
  | 'project'
  | 'merge_request'
  | 'pipeline'
  | 'pipeline_event'
  | 'issue'
  | 'release';

export interface GitLabSettings {
  host: string;
  projectIds?: readonly number[];
  groupIds?: readonly number[];
  resources?: readonly GitLabResource[];
}

const gitlabCredentials = {
  apiToken: {
    description: 'GitLab Personal Access Token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type GitLabCredentials = typeof gitlabCredentials;

const DEFAULT_HOST = 'gitlab.com';
const PAGE_SIZE = 100;

const gitlabRateLimit = standardRateLimitPolicy({
  remainingHeader: 'ratelimit-remaining',
  resetHeader: 'ratelimit-reset',
  resetUnit: 's',
});

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = [
  'projects',
  'merge_requests',
  'pipelines',
  'issues',
  'releases',
] as const;

type GitLabPhase = (typeof PHASE_ORDER)[number];

type GitLabSyncCursor = ChunkedSyncCursor<GitLabPhase, string>;

const isGitLabSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

// Page cursor encoding: `<projectIdx>|<pageUrl?>`.
// - null page          -> start at projectIdx=0 with no URL yet
// - "<idx>|"           -> start of project at idx, build initial URL
// - "<idx>|<url>"      -> continuing pagination for project at idx
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
// GitLab API types
// ---------------------------------------------------------------------------

interface GitLabUserRef {
  id: number;
  username: string;
  name?: string | null;
}

interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch: string | null;
  web_url: string;
  created_at: string;
  last_activity_at?: string | null;
  archived?: boolean;
  visibility?: string;
}

interface GitLabMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
  author: GitLabUserRef | null;
  assignees?: GitLabUserRef[];
  source_branch: string;
  target_branch: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  web_url: string;
}

interface GitLabPipeline {
  id: number;
  iid?: number;
  project_id: number;
  status: string;
  ref: string | null;
  sha: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  duration?: number | null;
  web_url: string;
}

interface GitLabIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  state: string;
  labels: string[];
  author: GitLabUserRef | null;
  assignees?: GitLabUserRef[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  web_url: string;
}

interface GitLabRelease {
  tag_name: string;
  name: string | null;
  description?: string | null;
  created_at: string;
  released_at: string | null;
  author?: GitLabUserRef | null;
}

// ---------------------------------------------------------------------------
// Zod response schemas
// ---------------------------------------------------------------------------

const userRefSchema = z.object({
  id: z.number().int(),
  username: z.string().min(1),
  name: z.string().nullable().optional(),
});

const projectSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  path_with_namespace: z.string().min(1),
  default_branch: z.string().nullable(),
  web_url: z.string(),
  created_at: z.iso.datetime(),
  last_activity_at: z.iso.datetime().nullable().optional(),
  archived: z.boolean().optional(),
  visibility: z.string().optional(),
});

const projectsResponseSchema = z.array(projectSchema);

const mergeRequestSchema = z.object({
  id: z.number().int(),
  iid: z.number().int(),
  project_id: z.number().int(),
  title: z.string(),
  state: z.string().min(1),
  draft: z.boolean().optional(),
  work_in_progress: z.boolean().optional(),
  author: userRefSchema.nullable(),
  assignees: z.array(userRefSchema).optional(),
  source_branch: z.string(),
  target_branch: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  merged_at: z.iso.datetime().nullable(),
  closed_at: z.iso.datetime().nullable(),
  web_url: z.string(),
});

const mergeRequestsResponseSchema = z.array(mergeRequestSchema);

const pipelineSchema = z.object({
  id: z.number().int(),
  iid: z.number().int().optional(),
  project_id: z.number().int(),
  status: z.string().min(1),
  ref: z.string().nullable(),
  sha: z.string().min(1),
  source: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  started_at: z.iso.datetime().nullable().optional(),
  finished_at: z.iso.datetime().nullable().optional(),
  duration: z.number().nullable().optional(),
  web_url: z.string(),
});

const pipelinesResponseSchema = z.array(pipelineSchema);

const issueSchema = z.object({
  id: z.number().int(),
  iid: z.number().int(),
  project_id: z.number().int(),
  title: z.string(),
  state: z.string().min(1),
  labels: z.array(z.string()),
  author: userRefSchema.nullable(),
  assignees: z.array(userRefSchema).optional(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  closed_at: z.iso.datetime().nullable(),
  web_url: z.string(),
});

const issuesResponseSchema = z.array(issueSchema);

const releaseSchema = z.object({
  tag_name: z.string().min(1),
  name: z.string().nullable(),
  description: z.string().nullable().optional(),
  created_at: z.iso.datetime(),
  released_at: z.iso.datetime().nullable(),
  author: userRefSchema.nullable().optional(),
});

const releasesResponseSchema = z.array(releaseSchema);

// ---------------------------------------------------------------------------
// Resource definitions
// ---------------------------------------------------------------------------

export const gitlabResources = defineResources({
  project: {
    shape: 'entity',
    description:
      'GitLab projects (repositories) with namespace path, default branch, and archived/visibility flags.',
    endpoint: 'GET /api/v4/projects/{id}',
    notes:
      'Discovered from configured `projectIds` and from `groupIds` via GET /api/v4/groups/{id}/projects?include_subgroups=true.',
    responses: { projects: projectsResponseSchema },
  },
  merge_request: {
    shape: 'entity',
    description:
      'Open, merged, and closed merge requests with author, source/target branches, and merge timestamps.',
    endpoint: 'GET /api/v4/projects/{id}/merge_requests',
    responses: { merge_requests: mergeRequestsResponseSchema },
  },
  pipeline: {
    shape: 'entity',
    description:
      'CI/CD pipelines with status, ref, commit sha, source, duration, and start/finish timestamps.',
    endpoint: 'GET /api/v4/projects/{id}/pipelines',
    responses: { pipelines: pipelinesResponseSchema },
  },
  pipeline_event: {
    shape: 'event',
    description:
      'Pipeline lifecycle events. One event per pipeline covering created_at to finished_at (or updated_at if not yet finished), tagged with the terminal status.',
    endpoint: 'GET /api/v4/projects/{id}/pipelines',
    notes:
      'Derived from the same pipelines response that builds the `pipeline` resource; the GitLab API does not expose an intermediate state-transition history endpoint.',
  },
  issue: {
    shape: 'entity',
    description:
      'Open and closed issues with labels, author, assignees, and close timestamp.',
    endpoint: 'GET /api/v4/projects/{id}/issues',
    responses: { issues: issuesResponseSchema },
  },
  release: {
    shape: 'entity',
    description:
      'Project releases keyed by tag name, including released_at and the publishing author.',
    endpoint: 'GET /api/v4/projects/{id}/releases',
    responses: { releases: releasesResponseSchema },
  },
});

export const id = 'gitlab';

// ---------------------------------------------------------------------------
// Connector class
// ---------------------------------------------------------------------------

interface ProjectBatch<T> {
  projectId: number;
  items: T[];
}

export class GitLabConnector extends BaseConnector<
  GitLabSettings,
  GitLabCredentials
> {
  static readonly id = id;

  static readonly resources = gitlabResources;

  static readonly schemas = schemasFromResources(gitlabResources);

  static create(input: unknown, ctx?: ConnectorContext): GitLabConnector {
    const parsed = configFields.parse(input);
    return new GitLabConnector(
      {
        host: parsed.host ?? DEFAULT_HOST,
        projectIds: parsed.projectIds,
        groupIds: parsed.groupIds,
        resources: parsed.resources,
      },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = gitlabCredentials;

  private effectiveProjectIds: number[] | null = null;
  private projectMetadataCache = new Map<number, GitLabProject>();

  constructor(
    settings: GitLabSettings,
    creds?: { apiToken: { $secret: string } | string },
    ctx?: ConnectorContext,
  ) {
    super({ ...settings, host: settings.host || DEFAULT_HOST }, creds, ctx);
  }

  private buildHeaders(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': this.creds.apiToken,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('gitlab'),
    };
  }

  private apiBase(): string {
    return `https://${this.settings.host}/api/v4`;
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
      rateLimit: gitlabRateLimit,
    });
  }

  private sanitizeUrl(url: string | null, expectedPath: string): string | null {
    if (!url) {
      return null;
    }
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.host !== this.settings.host) {
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
    GitLabPhase,
    readonly GitLabResource[]
  > = {
    projects: ['project'],
    merge_requests: ['merge_request'],
    pipelines: ['pipeline', 'pipeline_event'],
    issues: ['issue'],
    releases: ['release'],
  };

  private activePhases(
    optionsResources: ReadonlySet<string> | undefined,
  ): GitLabPhase[] {
    const fromSettings = selectActivePhases<GitLabResource, GitLabPhase>(
      (r) => {
        switch (r) {
          case 'project':
            return 'projects';
          case 'merge_request':
            return 'merge_requests';
          case 'pipeline':
          case 'pipeline_event':
            return 'pipelines';
          case 'issue':
            return 'issues';
          case 'release':
            return 'releases';
        }
      },
      PHASE_ORDER,
      this.settings.resources,
    );
    if (optionsResources === undefined) {
      return fromSettings;
    }
    return fromSettings.filter((phase) =>
      GitLabConnector.PHASE_RESOURCES[phase].some((r) =>
        optionsResources.has(r),
      ),
    );
  }

  private isResourceAllowed(
    resource: GitLabResource,
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
  // Effective project ID resolution.  Combines explicit `projectIds` with all
  // projects under each configured `groupIds` (recursing into subgroups).
  // -------------------------------------------------------------------------

  private async resolveEffectiveProjectIds(
    signal: AbortSignal | undefined,
  ): Promise<number[]> {
    if (this.effectiveProjectIds !== null) {
      return this.effectiveProjectIds;
    }
    const seen = new Set<number>();
    const ordered: number[] = [];
    const addId = (n: number) => {
      if (!seen.has(n)) {
        seen.add(n);
        ordered.push(n);
      }
    };
    for (const pid of this.settings.projectIds ?? []) {
      addId(pid);
    }
    for (const gid of this.settings.groupIds ?? []) {
      const projects = await this.fetchGroupProjects(gid, signal);
      for (const p of projects) {
        this.projectMetadataCache.set(p.id, p);
        addId(p.id);
      }
    }
    ordered.sort((a, b) => a - b);
    this.effectiveProjectIds = ordered;
    return ordered;
  }

  private async fetchGroupProjects(
    groupId: number,
    signal: AbortSignal | undefined,
  ): Promise<GitLabProject[]> {
    const out: GitLabProject[] = [];
    const baseUrl = `${this.apiBase()}/groups/${groupId}/projects`;
    let url: string | null =
      `${baseUrl}?per_page=${PAGE_SIZE}&include_subgroups=true&archived=false`;
    const expectedPath = `/api/v4/groups/${groupId}/projects`;
    while (url !== null) {
      const res = await this.fetch<GitLabProject[]>(
        url,
        'group_projects',
        signal,
      );
      for (const project of res.body) {
        out.push(project);
      }
      const next = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
      url = this.sanitizeUrl(next, expectedPath);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Per-phase fetchers
  // -------------------------------------------------------------------------

  private async fetchProjectMetadata(
    projectId: number,
    signal: AbortSignal | undefined,
  ): Promise<GitLabProject | null> {
    if (this.projectMetadataCache.has(projectId)) {
      return this.projectMetadataCache.get(projectId)!;
    }
    const url = `${this.apiBase()}/projects/${projectId}`;
    const res = await this.fetch<GitLabProject>(url, 'project', signal);
    this.projectMetadataCache.set(projectId, res.body);
    return res.body;
  }

  private async fetchProjectsPhase(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const projects = await this.resolveEffectiveProjectIds(signal);
    if (projects.length === 0) {
      return { items: [], next: null };
    }
    const { idx } = decodePage(page);
    if (idx >= projects.length) {
      return { items: [], next: null };
    }
    const projectId = projects[idx]!;
    const project = await this.fetchProjectMetadata(projectId, signal);
    const nextIdx = idx + 1;
    const next = nextIdx < projects.length ? encodePage(nextIdx, null) : null;
    return { items: project ? [project] : [], next };
  }

  private buildListPageUrl(
    projectId: number,
    resource: 'merge_requests' | 'pipelines' | 'issues' | 'releases',
    options: SyncOptions,
  ): string {
    const u = new URL(`${this.apiBase()}/projects/${projectId}/${resource}`);
    u.searchParams.set('per_page', String(PAGE_SIZE));
    switch (resource) {
      case 'merge_requests':
        u.searchParams.set('state', 'all');
        u.searchParams.set('order_by', 'updated_at');
        u.searchParams.set('sort', 'desc');
        u.searchParams.set('scope', 'all');
        if (options.since) {
          u.searchParams.set('updated_after', options.since);
        }
        break;
      case 'pipelines':
        u.searchParams.set('order_by', 'updated_at');
        u.searchParams.set('sort', 'desc');
        if (options.since) {
          u.searchParams.set('updated_after', options.since);
        }
        break;
      case 'issues':
        u.searchParams.set('state', 'all');
        u.searchParams.set('order_by', 'updated_at');
        u.searchParams.set('sort', 'desc');
        u.searchParams.set('scope', 'all');
        if (options.since) {
          u.searchParams.set('updated_after', options.since);
        }
        break;
      case 'releases':
        u.searchParams.set('order_by', 'released_at');
        u.searchParams.set('sort', 'desc');
        break;
    }
    return u.toString();
  }

  private async fetchListPhase<T>(
    options: SyncOptions,
    page: string | null,
    signal: AbortSignal | undefined,
    resource: 'merge_requests' | 'pipelines' | 'issues' | 'releases',
    rowUpdatedAt: (row: T) => number,
  ): Promise<FetchPageResult<string>> {
    const projects = await this.resolveEffectiveProjectIds(signal);
    if (projects.length === 0) {
      return { items: [], next: null };
    }
    const { idx, url: rawPageUrl } = decodePage(page);
    if (idx >= projects.length) {
      return { items: [], next: null };
    }
    const projectId = projects[idx]!;
    const expectedPath = `/api/v4/projects/${projectId}/${resource}`;
    const fetchUrl =
      this.sanitizeUrl(rawPageUrl, expectedPath) ??
      this.buildListPageUrl(projectId, resource, options);
    const res = await this.fetch<T[]>(fetchUrl, resource, signal);
    const rawNext = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    const safeNext = this.sanitizeUrl(rawNext, expectedPath);
    const rows = res.body;

    const cutoff = options.since ? new Date(options.since).getTime() : null;
    let filtered: T[];
    let cutoffReached: boolean;
    if (cutoff !== null) {
      filtered = rows.filter((row) => rowUpdatedAt(row) >= cutoff);
      const last = rows.at(-1);
      cutoffReached = last !== undefined && rowUpdatedAt(last) < cutoff;
    } else {
      filtered = rows;
      cutoffReached = false;
    }

    const nextWithinProject = cutoffReached ? null : safeNext;
    const batch: ProjectBatch<T> = { projectId, items: filtered };
    if (nextWithinProject !== null) {
      return { items: [batch], next: encodePage(idx, nextWithinProject) };
    }
    const nextIdx = idx + 1;
    const next = nextIdx < projects.length ? encodePage(nextIdx, null) : null;
    return { items: [batch], next };
  }

  // -------------------------------------------------------------------------
  // Writers
  // -------------------------------------------------------------------------

  private async writeProjects(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
  ): Promise<void> {
    if (page === null) {
      await storage.entities([], { types: ['project'] });
    }
    const projects = items as GitLabProject[];
    for (const project of projects) {
      const updatedAt = new Date(
        project.last_activity_at ?? project.created_at,
      ).getTime();
      await storage.entity({
        type: 'project',
        id: String(project.id),
        attributes: {
          name: project.name,
          path_with_namespace: project.path_with_namespace,
          default_branch: project.default_branch ?? '',
          web_url: project.web_url,
          visibility: project.visibility ?? '',
          archived: project.archived ?? false,
          created_at: new Date(project.created_at).getTime(),
        },
        updated_at: updatedAt,
      });
    }
  }

  private async writeMergeRequests(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
    options: SyncOptions,
  ): Promise<void> {
    if (page === null && !options.since) {
      await storage.entities([], { types: ['merge_request'] });
    }
    const batches = items as ProjectBatch<GitLabMergeRequest>[];
    for (const batch of batches) {
      for (const mr of batch.items) {
        await storage.entity({
          type: 'merge_request',
          id: `${batch.projectId}:${mr.iid}`,
          attributes: {
            project_id: batch.projectId,
            iid: mr.iid,
            title: mr.title,
            state: mr.state,
            draft: mr.draft ?? mr.work_in_progress ?? false,
            author: mr.author?.username ?? '',
            assignees: (mr.assignees ?? []).map((a) => a.username),
            source_branch: mr.source_branch,
            target_branch: mr.target_branch,
            web_url: mr.web_url,
            created_at: new Date(mr.created_at).getTime(),
            merged_at: mr.merged_at ? new Date(mr.merged_at).getTime() : null,
            closed_at: mr.closed_at ? new Date(mr.closed_at).getTime() : null,
          },
          updated_at: new Date(mr.updated_at).getTime(),
        });
      }
    }
  }

  private async writePipelines(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
    options: SyncOptions,
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
    const batches = items as ProjectBatch<GitLabPipeline>[];
    for (const batch of batches) {
      for (const pipeline of batch.items) {
        const createdMs = new Date(pipeline.created_at).getTime();
        const updatedMs = new Date(pipeline.updated_at).getTime();
        const finishedMs = pipeline.finished_at
          ? new Date(pipeline.finished_at).getTime()
          : null;
        const durationMs =
          pipeline.duration !== null && pipeline.duration !== undefined
            ? Math.round(pipeline.duration * 1000)
            : finishedMs !== null
              ? finishedMs - createdMs
              : null;
        if (pipelineAllowed) {
          await storage.entity({
            type: 'pipeline',
            id: `${batch.projectId}:${pipeline.id}`,
            attributes: {
              project_id: batch.projectId,
              pipeline_id: pipeline.id,
              status: pipeline.status,
              ref: pipeline.ref ?? '',
              sha: pipeline.sha,
              source: pipeline.source ?? '',
              web_url: pipeline.web_url,
              created_at: createdMs,
              finished_at: finishedMs,
              duration_ms: durationMs,
            },
            updated_at: updatedMs,
          });
        }
        if (eventAllowed) {
          await storage.event({
            name: 'pipeline_event',
            start_ts: createdMs,
            end_ts: finishedMs ?? updatedMs,
            attributes: {
              project_id: batch.projectId,
              pipeline_id: pipeline.id,
              status: pipeline.status,
              ref: pipeline.ref ?? '',
              sha: pipeline.sha,
              source: pipeline.source ?? '',
              duration_ms: durationMs,
            },
          });
        }
      }
    }
  }

  private async writeIssues(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
    options: SyncOptions,
  ): Promise<void> {
    if (page === null && !options.since) {
      await storage.entities([], { types: ['issue'] });
    }
    const batches = items as ProjectBatch<GitLabIssue>[];
    for (const batch of batches) {
      for (const issue of batch.items) {
        await storage.entity({
          type: 'issue',
          id: `${batch.projectId}:${issue.iid}`,
          attributes: {
            project_id: batch.projectId,
            iid: issue.iid,
            title: issue.title,
            state: issue.state,
            labels: issue.labels,
            author: issue.author?.username ?? '',
            assignees: (issue.assignees ?? []).map((a) => a.username),
            web_url: issue.web_url,
            created_at: new Date(issue.created_at).getTime(),
            closed_at: issue.closed_at
              ? new Date(issue.closed_at).getTime()
              : null,
          },
          updated_at: new Date(issue.updated_at).getTime(),
        });
      }
    }
  }

  private async writeReleases(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
    options: SyncOptions,
  ): Promise<void> {
    if (page === null && !options.since) {
      await storage.entities([], { types: ['release'] });
    }
    const batches = items as ProjectBatch<GitLabRelease>[];
    for (const batch of batches) {
      for (const release of batch.items) {
        const createdMs = new Date(release.created_at).getTime();
        const releasedMs = release.released_at
          ? new Date(release.released_at).getTime()
          : null;
        await storage.entity({
          type: 'release',
          id: `${batch.projectId}:${release.tag_name}`,
          attributes: {
            project_id: batch.projectId,
            tag_name: release.tag_name,
            name: release.name ?? '',
            description: release.description ?? '',
            author: release.author?.username ?? '',
            created_at: createdMs,
            released_at: releasedMs,
          },
          updated_at: releasedMs ?? createdMs,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Cursor resume
  // -------------------------------------------------------------------------

  private resolveCursor(cursor: unknown): GitLabSyncCursor | undefined {
    if (!isGitLabSyncCursor(cursor)) {
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
    return paginateChunked<GitLabPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'projects':
            return this.fetchProjectsPhase(page, sig);
          case 'merge_requests':
            return this.fetchListPhase<GitLabMergeRequest>(
              options,
              page,
              sig,
              'merge_requests',
              (mr) => new Date(mr.updated_at).getTime(),
            );
          case 'pipelines':
            return this.fetchListPhase<GitLabPipeline>(
              options,
              page,
              sig,
              'pipelines',
              (p) => new Date(p.updated_at).getTime(),
            );
          case 'issues':
            return this.fetchListPhase<GitLabIssue>(
              options,
              page,
              sig,
              'issues',
              (i) => new Date(i.updated_at).getTime(),
            );
          case 'releases':
            return this.fetchListPhase<GitLabRelease>(
              options,
              page,
              sig,
              'releases',
              (r) => new Date(r.released_at ?? r.created_at).getTime(),
            );
        }
      },
      writeBatch: async (phase, items, page) => {
        switch (phase) {
          case 'projects':
            return this.writeProjects(storage, items, page);
          case 'merge_requests':
            return this.writeMergeRequests(storage, items, page, options);
          case 'pipelines':
            return this.writePipelines(storage, items, page, options);
          case 'issues':
            return this.writeIssues(storage, items, page, options);
          case 'releases':
            return this.writeReleases(storage, items, page, options);
        }
      },
    });
  }
}
