import {
  type HttpResponse,
  connectorUserAgent,
  parseLinkHeader,
  sanitizeAllowedUrl,
  standardRateLimitPolicy,
} from '@rawdash/connector-shared';
import {
  type AggregateRequest,
  type AggregateValue,
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type CredentialsSchema,
  type FetchPageResult,
  type FilterClause,
  type FilterCondition,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  makeChunkedCursorGuard,
  paginateChunked,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    owner: z.string().min(1).meta({
      label: 'Repository owner',
      description: 'GitHub username or organization name.',
      placeholder: 'rawdash',
    }),
    repo: z.string().min(1).meta({
      label: 'Repository',
      description: 'Repository name.',
      placeholder: 'rawdash',
    }),
    token: z.object({ $secret: z.string() }).optional().meta({
      label: 'Personal access token',
      description: 'GitHub PAT with `repo` scope.',
      secret: true,
    }),
  }),
);

export interface GitHubSettings {
  owner: string;
  repo: string;
}

interface GitHubRunsResponse {
  workflow_runs: Array<{
    id: number;
    name: string;
    conclusion: string | null;
    status: string;
    head_branch: string | null;
    actor: { login: string } | null;
    created_at: string;
    updated_at: string;
    run_attempt: number;
  }>;
}

interface GitHubPR {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  user: { login: string };
  created_at: string;
  updated_at: string;
}

interface GitHubReview {
  user: { login: string } | null;
  state: string;
  submitted_at: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  user: { login: string };
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request?: unknown;
}

interface GitHubDeployment {
  id: number;
  environment: string;
  ref: string;
  sha: string;
  creator: { login: string } | null;
  created_at: string;
}

interface GitHubDeploymentStatus {
  state: string;
  updated_at: string;
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  author: { login: string };
}

interface GitHubContributorStats {
  total: number;
  weeks: Array<{ w: number; a: number; d: number; c: number }>;
  author: { login: string };
}

interface GitHubRepo {
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
}

const githubCredentials = {
  token: {
    description: 'GitHub personal access token',
    auth: 'optional' as const,
  },
} satisfies CredentialsSchema;

type GitHubCredentials = typeof githubCredentials;

type GitHubSyncPhase =
  | 'repo_stats'
  | 'workflow_runs'
  | 'pull_requests'
  | 'issues'
  | 'deployments'
  | 'releases'
  | 'contributors';

const githubRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-ratelimit-remaining',
  resetHeader: 'x-ratelimit-reset',
  resetUnit: 's',
});

const PHASE_ORDER: readonly GitHubSyncPhase[] = [
  'repo_stats',
  'workflow_runs',
  'pull_requests',
  'issues',
  'deployments',
  'releases',
  'contributors',
];

const PHASE_RESOURCES: Record<GitHubSyncPhase, readonly string[]> = {
  repo_stats: ['repo'],
  workflow_runs: ['workflow_run'],
  pull_requests: ['pull_request'],
  issues: ['issue'],
  deployments: ['deployment'],
  releases: ['release'],
  contributors: ['contributor'],
};

function selectPhases(
  allowlist: ReadonlySet<string> | undefined,
): readonly GitHubSyncPhase[] {
  if (allowlist === undefined) {
    return PHASE_ORDER;
  }
  return PHASE_ORDER.filter((phase) =>
    PHASE_RESOURCES[phase].some((r) => allowlist.has(r)),
  );
}

type GitHubSyncCursor = ChunkedSyncCursor<GitHubSyncPhase, string>;

interface PRPageItems {
  prs: GitHubPR[];
  reviewsByPR: Map<number, GitHubReview[]>;
}

interface DeploymentPageItems {
  deployments: GitHubDeployment[];
  latestStatusById: Map<number, GitHubDeploymentStatus | null>;
}

const CONTRIBUTORS_SKIPPED = Symbol('contributors-skipped');

function dedupeByKey<T>(
  items: T[],
  keyFn: (item: T) => string,
  resource: string,
): T[] {
  if (items.length < 2) {
    return items;
  }
  const seen = new Map<string, T>();
  let duplicates = 0;
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) {
      duplicates++;
    }
    seen.set(key, item);
  }
  if (duplicates > 0) {
    console.warn(
      `[github-actions] ${resource}: dropped ${duplicates} duplicate id(s) — keeping latest copy of each`,
    );
  }
  return Array.from(seen.values());
}

const isGitHubSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const workflowRunsResponseSchema = z.object({
  total_count: z.number().int().optional(),
  workflow_runs: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      conclusion: z.string().nullable(),
      status: z.string(),
      head_branch: z.string().nullable(),
      actor: z.object({ login: z.string().min(1) }).nullable(),
      created_at: z.iso.datetime(),
      updated_at: z.iso.datetime(),
      run_attempt: z.number().int(),
      artifacts_url: z.string().optional(),
      cancel_url: z.string().optional(),
      check_suite_id: z.number().int().optional(),
      check_suite_node_id: z.string().optional(),
      check_suite_url: z.string().optional(),
      display_title: z.string().optional(),
      event: z.string().optional(),
      head_commit: z.unknown().optional(),
      head_repository: z.unknown().optional(),
      head_sha: z.string().optional(),
      html_url: z.string().optional(),
      jobs_url: z.string().optional(),
      logs_url: z.string().optional(),
      node_id: z.string().optional(),
      path: z.string().optional(),
      previous_attempt_url: z.string().nullable().optional(),
      pull_requests: z.array(z.unknown()).optional(),
      referenced_workflows: z.array(z.unknown()).optional(),
      repository: z.unknown().optional(),
      rerun_url: z.string().optional(),
      run_number: z.number().int().optional(),
      run_started_at: z.iso.datetime().optional(),
      triggering_actor: z.object({ login: z.string().min(1) }).optional(),
      url: z.string().optional(),
      workflow_id: z.number().int().optional(),
      workflow_url: z.string().optional(),
    }),
  ),
});

const pullRequestsSchema = z.array(
  z.object({
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    draft: z.boolean(),
    user: z.object({
      login: z.string().min(1),
      avatar_url: z.string().optional(),
      events_url: z.string().optional(),
      followers_url: z.string().optional(),
      following_url: z.string().optional(),
      gists_url: z.string().optional(),
      gravatar_id: z.string().nullable().optional(),
      html_url: z.string().optional(),
      id: z.number().int().optional(),
      node_id: z.string().optional(),
      organizations_url: z.string().optional(),
      received_events_url: z.string().optional(),
      repos_url: z.string().optional(),
      site_admin: z.boolean().optional(),
      starred_url: z.string().optional(),
      subscriptions_url: z.string().optional(),
      type: z.string().optional(),
      url: z.string().optional(),
      user_view_type: z.string().optional(),
    }),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    _links: z.unknown().optional(),
    active_lock_reason: z.string().nullable().optional(),
    assignee: z.unknown().optional(),
    assignees: z.unknown().optional(),
    author_association: z.string().optional(),
    auto_merge: z.unknown().optional(),
    base: z.unknown().optional(),
    body: z.string().nullable().optional(),
    closed_at: z.string().nullable().optional(),
    comments_url: z.string().optional(),
    commits_url: z.string().optional(),
    diff_url: z.string().optional(),
    head: z.unknown().optional(),
    html_url: z.string().optional(),
    id: z.number().int().optional(),
    issue_url: z.string().optional(),
    labels: z.unknown().optional(),
    locked: z.boolean().optional(),
    merge_commit_sha: z.string().nullable().optional(),
    merged_at: z.string().nullable().optional(),
    milestone: z.unknown().optional(),
    node_id: z.string().optional(),
    patch_url: z.string().optional(),
    requested_reviewers: z.unknown().optional(),
    requested_teams: z.unknown().optional(),
    review_comment_url: z.string().optional(),
    review_comments_url: z.string().optional(),
    statuses_url: z.string().optional(),
    url: z.string().optional(),
  }),
);

const reviewsSchema = z.array(
  z.object({
    user: z.object({ login: z.string().min(1) }).nullable(),
    state: z.string(),
    submitted_at: z.iso.datetime(),
  }),
);

const issuesSchema = z.array(
  z.object({
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    labels: z.array(z.object({ name: z.string() })),
    assignees: z.array(z.object({ login: z.string().min(1) })),
    user: z.object({ login: z.string().min(1) }).catchall(z.unknown()),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    closed_at: z.iso.datetime().nullable(),
    pull_request: z.unknown().optional(),
    active_lock_reason: z.unknown().optional(),
    assignee: z.unknown().optional(),
    author_association: z.string().optional(),
    body: z.string().nullable().optional(),
    closed_by: z.unknown().optional(),
    comments: z.number().int().optional(),
    comments_url: z.string().optional(),
    draft: z.boolean().optional(),
    events_url: z.string().optional(),
    html_url: z.string().optional(),
    id: z.number().int().optional(),
    issue_field_values: z.unknown().optional(),
    labels_url: z.string().optional(),
    locked: z.boolean().optional(),
    milestone: z.unknown().optional(),
    node_id: z.string().optional(),
    performed_via_github_app: z.unknown().optional(),
    reactions: z.unknown().optional(),
    repository_url: z.string().optional(),
    state_reason: z.unknown().optional(),
    timeline_url: z.string().optional(),
    type: z.unknown().optional(),
    url: z.string().optional(),
  }),
);

const deploymentsSchema = z.array(
  z.object({
    id: z.number().int(),
    environment: z.string(),
    ref: z.string(),
    sha: z.string(),
    creator: z.object({ login: z.string().min(1) }).nullable(),
    created_at: z.iso.datetime(),
  }),
);

const deploymentStatusesSchema = z.array(
  z.object({
    state: z.string(),
    updated_at: z.iso.datetime(),
  }),
);

const releasesSchema = z.array(
  z.object({
    id: z.number().int(),
    tag_name: z.string(),
    name: z.string().nullable(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    created_at: z.iso.datetime(),
    published_at: z.iso.datetime().nullable(),
    author: z.object({ login: z.string().min(1) }),
  }),
);

const contributorsSchema = z.array(
  z.object({
    total: z.number().int(),
    weeks: z.array(
      z.object({
        w: z.number().int(),
        a: z.number().int(),
        d: z.number().int(),
        c: z.number().int(),
      }),
    ),
    author: z.object({ login: z.string().min(1) }),
  }),
);

const repoStatsSchema = z.object({
  stargazers_count: z.number().int(),
  forks_count: z.number().int(),
  subscribers_count: z.number().int(),
});

export class GitHubConnector extends BaseConnector<
  GitHubSettings,
  GitHubCredentials
> {
  static readonly id = 'github-actions';

  static readonly schemas = {
    repo: repoStatsSchema,
    workflow_runs: workflowRunsResponseSchema,
    pull_requests: pullRequestsSchema,
    pull_request_reviews: reviewsSchema,
    issues: issuesSchema,
    deployments: deploymentsSchema,
    deployment_statuses: deploymentStatusesSchema,
    releases: releasesSchema,
    contributors: contributorsSchema,
  } as const;

  static create(input: unknown, ctx?: ConnectorContext): GitHubConnector {
    const parsed = configFields.parse(input);
    return new GitHubConnector(
      { owner: parsed.owner, repo: parsed.repo },
      { token: parsed.token },
      ctx,
    );
  }

  readonly id = 'github-actions';

  override readonly credentials = githubCredentials;

  private seenWorkflowRunIds = new Set<string>();

  private preservedDeploymentStatus = new Map<string, string>();

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': connectorUserAgent('github'),
    };
    if (this.creds.token) {
      headers['Authorization'] = `Bearer ${this.creds.token}`;
    }
    return headers;
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
      rateLimit: githubRateLimit,
    });
  }

  private allowedPageBasePath(phase: GitHubSyncPhase): string | null {
    const { owner, repo } = this.settings;
    switch (phase) {
      case 'workflow_runs':
        return `/repos/${owner}/${repo}/actions/runs`;
      case 'pull_requests':
        return `/repos/${owner}/${repo}/pulls`;
      case 'issues':
        return `/repos/${owner}/${repo}/issues`;
      case 'deployments':
        return `/repos/${owner}/${repo}/deployments`;
      case 'releases':
        return `/repos/${owner}/${repo}/releases`;
      case 'repo_stats':
      case 'contributors':
        return null;
    }
  }

  private sanitizePageUrl(
    phase: GitHubSyncPhase,
    pageUrl: string | null,
  ): string | null {
    const allowedPath = this.allowedPageBasePath(phase);
    if (allowedPath === null) {
      return null;
    }
    return sanitizeAllowedUrl({
      url: pageUrl,
      host: 'api.github.com',
      pathname: allowedPath,
    });
  }

  private isResourceAllowed(options: SyncOptions, resource: string): boolean {
    if (!options.resources) {
      return true;
    }
    return options.resources.has(resource);
  }

  private resolveCursor(cursor: unknown): GitHubSyncCursor | undefined {
    if (!isGitHubSyncCursor(cursor)) {
      return undefined;
    }
    return {
      phase: cursor.phase,
      page: this.sanitizePageUrl(cursor.phase, cursor.page),
    };
  }

  private async fetchRepoStats(
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const { owner, repo } = this.settings;
    const res = await this.fetch<GitHubRepo>(
      `https://api.github.com/repos/${owner}/${repo}`,
      'repo',
      signal,
    );
    return { items: [res.body], next: null };
  }

  private async fetchWorkflowRunsLatest(
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const { owner, repo } = this.settings;
    const res = await this.fetch<GitHubRunsResponse>(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=1`,
      'workflow_runs',
      signal,
    );
    const run = res.body.workflow_runs[0];
    return { items: run ? [run] : [], next: null };
  }

  private async fetchWorkflowRunsFull(
    options: SyncOptions,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const { owner, repo } = this.settings;
    const url =
      page ??
      `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=100`;
    const res = await this.fetch<GitHubRunsResponse>(
      url,
      'workflow_runs',
      signal,
    );
    const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    const runs = res.body.workflow_runs;
    const cutoff = options.since ? new Date(options.since).getTime() : null;

    const filtered = runs.filter((run) => {
      if (cutoff === null) {
        return true;
      }
      const createdMs = new Date(run.created_at).getTime();
      const updatedMs = new Date(run.updated_at).getTime();
      return !(createdMs < cutoff && updatedMs < cutoff);
    });

    const lastRun = runs.at(-1);
    const cutoffReached =
      cutoff !== null &&
      lastRun !== undefined &&
      new Date(lastRun.created_at).getTime() < cutoff &&
      new Date(lastRun.updated_at).getTime() < cutoff;

    return {
      items: filtered,
      next: cutoffReached ? null : nextLink,
    };
  }

  private async fetchPullRequests(
    options: SyncOptions,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const { owner, repo } = this.settings;
    const url =
      page ??
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`;
    const res = await this.fetch<GitHubPR[]>(url, 'pull_requests', signal);
    const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    const prs = res.body;
    const cutoff = options.since ? new Date(options.since).getTime() : null;
    const filteredPrs =
      cutoff !== null
        ? prs.filter((pr) => new Date(pr.updated_at).getTime() >= cutoff)
        : prs;
    const lastPr = prs.at(-1);
    const cutoffReached =
      cutoff !== null &&
      lastPr !== undefined &&
      new Date(lastPr.updated_at).getTime() < cutoff;

    const reviewsByPR = new Map<number, GitHubReview[]>();
    if (this.isResourceAllowed(options, 'pull_request_reviews')) {
      for (const pr of filteredPrs) {
        signal?.throwIfAborted();
        const reviews = await this.fetch<GitHubReview[]>(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/reviews`,
          'pull_request_reviews',
          signal,
        );
        reviewsByPR.set(pr.number, reviews.body);
      }
    }

    const items: PRPageItems[] = [{ prs: filteredPrs, reviewsByPR }];
    return { items, next: cutoffReached ? null : nextLink };
  }

  private async fetchIssues(
    options: SyncOptions,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const { owner, repo } = this.settings;
    let url: string;
    if (page) {
      url = page;
    } else {
      const u = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
      u.searchParams.set('state', 'all');
      u.searchParams.set('per_page', '100');
      if (options.since) {
        u.searchParams.set('since', options.since);
      }
      url = u.toString();
    }
    const res = await this.fetch<GitHubIssue[]>(url, 'issues', signal);
    const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    return { items: res.body, next: nextLink };
  }

  private async fetchDeployments(
    options: SyncOptions,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const { owner, repo } = this.settings;
    const url =
      page ??
      `https://api.github.com/repos/${owner}/${repo}/deployments?per_page=100`;
    const res = await this.fetch<GitHubDeployment[]>(
      url,
      'deployments',
      signal,
    );
    const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    const deployments = res.body;
    const cutoff = options.since ? new Date(options.since).getTime() : null;
    const filteredDeployments =
      cutoff !== null
        ? deployments.filter((d) => new Date(d.created_at).getTime() >= cutoff)
        : deployments;
    const lastDeployment = deployments.at(-1);
    const cutoffReached =
      cutoff !== null &&
      lastDeployment !== undefined &&
      new Date(lastDeployment.created_at).getTime() < cutoff;

    const latestStatusById = new Map<number, GitHubDeploymentStatus | null>();
    if (this.isResourceAllowed(options, 'deployment_statuses')) {
      for (const deployment of filteredDeployments) {
        signal?.throwIfAborted();
        const statusRes = await this.fetch<GitHubDeploymentStatus[]>(
          `https://api.github.com/repos/${owner}/${repo}/deployments/${deployment.id}/statuses?per_page=1`,
          'deployment_statuses',
          signal,
        );
        latestStatusById.set(deployment.id, statusRes.body[0] ?? null);
      }
    }

    const items: DeploymentPageItems[] = [
      { deployments: filteredDeployments, latestStatusById },
    ];
    return { items, next: cutoffReached ? null : nextLink };
  }

  private async fetchReleases(
    options: SyncOptions,
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const { owner, repo } = this.settings;
    const url =
      page ??
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`;
    const res = await this.fetch<GitHubRelease[]>(url, 'releases', signal);
    const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    const releases = res.body;
    const cutoff = options.since ? new Date(options.since).getTime() : null;
    const filtered =
      cutoff !== null
        ? releases.filter((r) => {
            const ts = new Date(r.published_at ?? r.created_at).getTime();
            return ts >= cutoff;
          })
        : releases;
    const lastRelease = releases.at(-1);
    const cutoffReached =
      cutoff !== null &&
      lastRelease !== undefined &&
      new Date(lastRelease.published_at ?? lastRelease.created_at).getTime() <
        cutoff;
    return { items: filtered, next: cutoffReached ? null : nextLink };
  }

  private async fetchContributors(
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const { owner, repo } = this.settings;
    const contributors = await this.withRetry<GitHubContributorStats[]>(
      async (sig) => {
        const res = await this.fetch<GitHubContributorStats[] | null>(
          `https://api.github.com/repos/${owner}/${repo}/stats/contributors`,
          'contributors',
          sig,
        );
        if (res.status === 202) {
          return { status: 'retry' };
        }
        return {
          status: 'done',
          value: (res.body ?? []) as GitHubContributorStats[],
        };
      },
      { maxAttempts: 15, initialDelayMs: 1000, maxDelayMs: 10000, signal },
    );

    if (!contributors) {
      console.warn(
        '[github-actions] Stats endpoint never became ready — skipping contributor sync and keeping previous data.',
      );
      return { items: [CONTRIBUTORS_SKIPPED], next: null };
    }
    return { items: contributors, next: null };
  }

  private async writeRepoStats(
    storage: StorageHandle,
    items: unknown[],
  ): Promise<void> {
    const repoBody = items[0] as GitHubRepo | undefined;
    if (!repoBody) {
      return;
    }
    const { owner, repo } = this.settings;
    await storage.entities(
      [
        {
          type: 'repo',
          id: `${owner}/${repo}`,
          attributes: {
            stars: repoBody.stargazers_count,
            forks: repoBody.forks_count,
            watchers: repoBody.subscribers_count,
          },
          updated_at: Date.now(),
        },
      ],
      { types: ['repo'] },
    );
  }

  private async writeWorkflowRunsLatest(
    storage: StorageHandle,
    items: unknown[],
  ): Promise<void> {
    const run = items[0] as
      | GitHubRunsResponse['workflow_runs'][number]
      | undefined;
    if (!run) {
      return;
    }
    await storage.event({
      name: 'workflow_run',
      start_ts: new Date(run.created_at).getTime(),
      end_ts: new Date(run.updated_at).getTime(),
      attributes: {
        id: run.id,
        workflow_name: run.name,
        conclusion: run.conclusion ?? 'unknown',
        status: run.status,
        branch: run.head_branch ?? '',
        actor: run.actor?.login ?? '',
        run_attempt: run.run_attempt,
      },
    });
  }

  private async writeWorkflowRunsFull(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
  ): Promise<void> {
    if (page === null) {
      await storage.events([], { names: ['workflow_run'] });
      this.seenWorkflowRunIds.clear();
    }
    const withinPage = dedupeByKey(
      items as GitHubRunsResponse['workflow_runs'],
      (run) => String(run.id),
      'workflow_runs',
    );
    let crossPageDuplicates = 0;
    const runs: GitHubRunsResponse['workflow_runs'] = [];
    for (const run of withinPage) {
      const key = String(run.id);
      if (this.seenWorkflowRunIds.has(key)) {
        crossPageDuplicates++;
        continue;
      }
      this.seenWorkflowRunIds.add(key);
      runs.push(run);
    }
    if (crossPageDuplicates > 0) {
      console.warn(
        `[github-actions] workflow_runs: dropped ${crossPageDuplicates} duplicate id(s) seen on an earlier page`,
      );
    }
    for (const run of runs) {
      await storage.event({
        name: 'workflow_run',
        start_ts: new Date(run.created_at).getTime(),
        end_ts: new Date(run.updated_at).getTime(),
        attributes: {
          id: run.id,
          workflow_name: run.name,
          conclusion: run.conclusion ?? 'unknown',
          status: run.status,
          branch: run.head_branch ?? '',
          actor: run.actor?.login ?? '',
          run_attempt: run.run_attempt,
        },
      });
    }
  }

  private async writePullRequests(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
    options: SyncOptions,
  ): Promise<void> {
    const reviewsAllowed = this.isResourceAllowed(
      options,
      'pull_request_reviews',
    );
    if (page === null) {
      await storage.entities([], { types: ['pull_request'] });
      if (reviewsAllowed) {
        await storage.edges([], { kinds: ['reviewed_by'] });
      }
    }
    const pageItems = items as PRPageItems[];
    for (const { prs: rawPrs, reviewsByPR } of pageItems) {
      const prs = dedupeByKey(
        rawPrs,
        (pr) => String(pr.number),
        'pull_requests',
      );
      for (const pr of prs) {
        await storage.entity({
          type: 'pull_request',
          id: String(pr.number),
          attributes: {
            title: pr.title,
            state: pr.state,
            draft: pr.draft,
            author: pr.user.login,
            created_at: new Date(pr.created_at).getTime(),
          },
          updated_at: new Date(pr.updated_at).getTime(),
        });
      }
      if (!reviewsAllowed) {
        continue;
      }
      for (const pr of prs) {
        const reviews = reviewsByPR.get(pr.number) ?? [];
        for (const review of reviews) {
          if (!review.user) {
            continue;
          }
          await storage.edge({
            from_type: 'pull_request',
            from_id: String(pr.number),
            kind: 'reviewed_by',
            to_type: 'user',
            to_id: review.user.login,
            attributes: { state: review.state },
            updated_at: new Date(review.submitted_at).getTime(),
          });
        }
      }
    }
  }

  private async writeIssues(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
  ): Promise<void> {
    if (page === null) {
      await storage.entities([], { types: ['issue'] });
    }
    const issues = dedupeByKey(
      (items as GitHubIssue[]).filter((i) => i.pull_request === undefined),
      (issue) => String(issue.number),
      'issues',
    );
    for (const issue of issues) {
      await storage.entity({
        type: 'issue',
        id: String(issue.number),
        attributes: {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          labels: issue.labels.map((l) => l.name),
          assignees: issue.assignees.map((a) => a.login),
          author: issue.user.login,
          created_at: new Date(issue.created_at).getTime(),
          updated_at: new Date(issue.updated_at).getTime(),
          closed_at: issue.closed_at
            ? new Date(issue.closed_at).getTime()
            : null,
        },
        updated_at: new Date(issue.updated_at).getTime(),
      });
    }
  }

  private async writeDeployments(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
    options: SyncOptions,
  ): Promise<void> {
    const statusesAllowed = this.isResourceAllowed(
      options,
      'deployment_statuses',
    );
    if (page === null) {
      if (!statusesAllowed) {
        const existing = await storage.queryEntities({ type: 'deployment' });
        for (const entity of existing) {
          const prev = entity.attributes['latest_status'];
          if (typeof prev === 'string') {
            this.preservedDeploymentStatus.set(entity.id, prev);
          }
        }
      }
      await storage.entities([], { types: ['deployment'] });
    }
    const pageItems = items as DeploymentPageItems[];
    for (const { deployments: rawDeployments, latestStatusById } of pageItems) {
      const deployments = dedupeByKey(
        rawDeployments,
        (d) => String(d.id),
        'deployments',
      );
      for (const deployment of deployments) {
        const createdMs = new Date(deployment.created_at).getTime();
        let latestStatus: string;
        let statusUpdatedMs: number | null = null;
        if (statusesAllowed) {
          const status = latestStatusById.get(deployment.id) ?? null;
          latestStatus = status?.state ?? 'unknown';
          statusUpdatedMs = status?.updated_at
            ? new Date(status.updated_at).getTime()
            : null;
        } else {
          latestStatus =
            this.preservedDeploymentStatus.get(String(deployment.id)) ??
            'unknown';
        }
        await storage.entity({
          type: 'deployment',
          id: String(deployment.id),
          attributes: {
            environment: deployment.environment,
            ref: deployment.ref,
            sha: deployment.sha,
            creator: deployment.creator?.login ?? '',
            created_at: createdMs,
            latest_status: latestStatus,
          },
          updated_at: Math.max(createdMs, statusUpdatedMs ?? 0),
        });
      }
    }
  }

  private async writeReleases(
    storage: StorageHandle,
    items: unknown[],
    page: string | null,
  ): Promise<void> {
    if (page === null) {
      await storage.entities([], { types: ['release'] });
    }
    const releases = dedupeByKey(
      items as GitHubRelease[],
      (r) => String(r.id),
      'releases',
    );
    for (const release of releases) {
      await storage.entity({
        type: 'release',
        id: String(release.id),
        attributes: {
          tag_name: release.tag_name,
          name: release.name ?? '',
          draft: release.draft,
          prerelease: release.prerelease,
          created_at: new Date(release.created_at).getTime(),
          published_at: release.published_at
            ? new Date(release.published_at).getTime()
            : null,
          author: release.author.login,
        },
        updated_at: new Date(
          release.published_at ?? release.created_at,
        ).getTime(),
      });
    }
  }

  private async writeContributors(
    storage: StorageHandle,
    items: unknown[],
  ): Promise<void> {
    if (items[0] === CONTRIBUTORS_SKIPPED) {
      return;
    }
    const contributors = dedupeByKey(
      items as GitHubContributorStats[],
      (c) => c.author.login,
      'contributors',
    );
    await storage.entities(
      contributors.map((c) => {
        const additions = c.weeks.reduce((sum, w) => sum + w.a, 0);
        const deletions = c.weeks.reduce((sum, w) => sum + w.d, 0);
        const latestWeek = [...c.weeks].reverse().find((w) => w.c > 0);
        return {
          type: 'contributor',
          id: c.author.login,
          attributes: {
            commits: c.total,
            additions,
            deletions,
            latest_commit_at: latestWeek ? latestWeek.w * 1000 : null,
          },
          updated_at: latestWeek ? latestWeek.w * 1000 : 0,
        };
      }),
      { types: ['contributor'] },
    );
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const phases = selectPhases(options.resources);
    return paginateChunked<GitHubSyncPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'repo_stats':
            return this.fetchRepoStats(sig);
          case 'workflow_runs':
            return options.mode === 'latest'
              ? this.fetchWorkflowRunsLatest(sig)
              : this.fetchWorkflowRunsFull(options, page, sig);
          case 'pull_requests':
            return this.fetchPullRequests(options, page, sig);
          case 'issues':
            return this.fetchIssues(options, page, sig);
          case 'deployments':
            return this.fetchDeployments(options, page, sig);
          case 'releases':
            return this.fetchReleases(options, page, sig);
          case 'contributors':
            return this.fetchContributors(sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        switch (phase) {
          case 'repo_stats':
            return this.writeRepoStats(storage, items);
          case 'workflow_runs':
            return options.mode === 'latest'
              ? this.writeWorkflowRunsLatest(storage, items)
              : this.writeWorkflowRunsFull(storage, items, page);
          case 'pull_requests':
            return this.writePullRequests(storage, items, page, options);
          case 'issues':
            return this.writeIssues(storage, items, page);
          case 'deployments':
            return this.writeDeployments(storage, items, page, options);
          case 'releases':
            return this.writeReleases(storage, items, page);
          case 'contributors':
            return this.writeContributors(storage, items);
        }
      },
    });
  }

  override async aggregate(
    req: AggregateRequest,
    signal?: AbortSignal,
  ): Promise<AggregateValue> {
    if (req.fn === 'count') {
      return this.aggregateCount(req, signal);
    }
    return this.aggregateLatest(req, signal);
  }

  validateCountFilter(resource: string, filter: FilterClause[]): void {
    if (resource === 'contributor') {
      if (filter.length > 0) {
        throw new Error(
          `GitHub aggregate count(contributor): filters are not supported`,
        );
      }
      return;
    }
    if (resource !== 'pull_request' && resource !== 'issue') {
      throw new Error(
        `GitHub aggregate count: unsupported resource=${resource}`,
      );
    }
    const conditions = filterConditions(filter);
    for (const c of conditions) {
      translateSearchQualifier(resource === 'pull_request' ? 'pr' : 'issue', c);
    }
  }

  private async aggregateCount(
    req: AggregateRequest,
    signal: AbortSignal | undefined,
  ): Promise<AggregateValue> {
    if (req.resource === 'pull_request') {
      return this.searchCount(
        'pr',
        filterConditions(req.filter),
        'pull_request',
        signal,
      );
    }
    if (req.resource === 'issue') {
      return this.searchCount(
        'issue',
        filterConditions(req.filter),
        'issue',
        signal,
      );
    }
    if (req.resource === 'contributor') {
      if (req.filter && req.filter.length > 0) {
        throw new Error(
          `GitHub aggregate count(contributor): filters are not supported`,
        );
      }
      const value = await this.countContributors(signal);
      this.logger.info('aggregate', {
        fn: 'count',
        resource: 'contributor',
        value,
        via: 'contributors API',
      });
      return value;
    }
    throw unsupportedAggregate(req);
  }

  private async aggregateLatest(
    req: AggregateRequest,
    signal: AbortSignal | undefined,
  ): Promise<AggregateValue> {
    const { owner, repo } = this.settings;
    if (req.resource === 'repo') {
      if (!req.field) {
        throw unsupportedAggregate(req);
      }
      const res = await this.fetch<GitHubRepo>(
        `https://api.github.com/repos/${owner}/${repo}`,
        'repo',
        signal,
      );
      let value: AggregateValue;
      if (req.field === 'stars') {
        value = res.body.stargazers_count;
      } else if (req.field === 'forks') {
        value = res.body.forks_count;
      } else if (req.field === 'watchers') {
        value = res.body.subscribers_count;
      } else {
        throw unsupportedAggregate(req);
      }
      this.logger.info('aggregate', {
        fn: 'latest',
        resource: 'repo',
        field: req.field,
        value,
        via: 'repo API',
      });
      return value;
    }
    if (req.resource === 'workflow_run') {
      if (!req.field) {
        throw unsupportedAggregate(req);
      }
      if (
        req.field !== 'conclusion' &&
        req.field !== 'status' &&
        req.field !== 'branch' &&
        req.field !== 'actor'
      ) {
        throw unsupportedAggregate(req);
      }
      const res = await this.fetch<GitHubRunsResponse>(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=1`,
        'workflow_runs',
        signal,
      );
      const run = res.body.workflow_runs[0];
      let value: AggregateValue;
      if (!run) {
        value = null;
      } else if (req.field === 'conclusion') {
        value = run.conclusion ?? 'unknown';
      } else if (req.field === 'status') {
        value = run.status;
      } else if (req.field === 'branch') {
        value = run.head_branch ?? '';
      } else {
        value = run.actor?.login ?? '';
      }
      this.logger.info('aggregate', {
        fn: 'latest',
        resource: 'workflow_run',
        field: req.field,
        value,
        via: 'actions/runs API',
      });
      return value;
    }
    if (req.resource === 'release') {
      if (
        req.field !== 'tag_name' &&
        req.field !== 'name' &&
        req.field !== 'author' &&
        req.field !== 'published_at'
      ) {
        throw unsupportedAggregate(req);
      }
      let release: GitHubRelease | null;
      try {
        const res = await this.fetch<GitHubRelease>(
          `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
          'releases',
          signal,
        );
        release = res.body;
      } catch (err) {
        if (isNotFound(err)) {
          release = null;
        } else {
          throw err;
        }
      }
      let value: AggregateValue;
      if (!release) {
        value = null;
      } else if (req.field === 'tag_name') {
        value = release.tag_name;
      } else if (req.field === 'name') {
        value = release.name ?? '';
      } else if (req.field === 'author') {
        value = release.author.login;
      } else if (req.field === 'published_at') {
        value = release.published_at
          ? new Date(release.published_at).getTime()
          : null;
      } else {
        throw unsupportedAggregate(req);
      }
      this.logger.info('aggregate', {
        fn: 'latest',
        resource: 'release',
        field: req.field,
        value,
        via: 'releases/latest API',
      });
      return value;
    }
    throw unsupportedAggregate(req);
  }

  private async searchCount(
    kind: 'pr' | 'issue',
    conditions: FilterCondition[],
    resourceLabel: 'pull_request' | 'issue',
    signal: AbortSignal | undefined,
  ): Promise<number> {
    const { owner, repo } = this.settings;
    const parts = [`repo:${owner}/${repo}`, `is:${kind}`];
    for (const c of conditions) {
      parts.push(translateSearchQualifier(kind, c));
    }
    const q = parts.join(' ');
    const url = `https://api.github.com/search/issues?per_page=1&q=${encodeURIComponent(q)}`;
    const res = await this.fetch<{ total_count: number }>(
      url,
      resourceLabel === 'pull_request' ? 'pull_requests' : 'issues',
      signal,
    );
    this.logger.info('aggregate', {
      fn: 'count',
      resource: resourceLabel,
      query: q,
      value: res.body.total_count,
      via: 'search API',
    });
    return res.body.total_count;
  }

  private async countContributors(
    signal: AbortSignal | undefined,
  ): Promise<number> {
    const { owner, repo } = this.settings;
    const res = await this.fetch<unknown[]>(
      `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1&anon=true`,
      'contributors',
      signal,
    );
    const link = res.headers.get('link');
    if (link) {
      const match = /[?&]page=(\d+)>;\s*rel="last"/.exec(link);
      if (match) {
        return parseInt(match[1]!, 10);
      }
    }
    return Array.isArray(res.body) ? res.body.length : 0;
  }
}

function translateSearchQualifier(
  kind: 'pr' | 'issue',
  c: FilterCondition,
): string {
  if (c.op !== 'eq') {
    throw new Error(
      `GitHub aggregate count for ${kind}: unsupported filter op ${c.op} (only 'eq' is supported)`,
    );
  }
  const value = String(c.value);
  switch (c.field) {
    case 'state':
      if (value !== 'open' && value !== 'closed') {
        throw new Error(
          `GitHub aggregate count for ${kind}: state must be 'open' or 'closed' (got ${value})`,
        );
      }
      return `is:${value}`;
    case 'draft':
      if (value === 'true' || c.value === true) {
        return 'is:draft';
      }
      if (value === 'false' || c.value === false) {
        return '-is:draft';
      }
      throw new Error(
        `GitHub aggregate count for ${kind}: draft must be boolean (got ${value})`,
      );
    case 'label':
      return `label:${quoteIfNeeded(value)}`;
    case 'author':
      return `author:${value}`;
    case 'assignee':
      return `assignee:${value}`;
    case 'milestone':
      return `milestone:${quoteIfNeeded(value)}`;
    case 'head':
      return `head:${value}`;
    case 'base':
      return `base:${value}`;
    default:
      throw new Error(
        `GitHub aggregate count for ${kind}: unsupported filter field ${c.field}`,
      );
  }
}

function isNotFound(err: unknown): boolean {
  // Duck-typed because HttpClientError can resolve to a different class
  // instance across module boundaries (vitest source-resolved vs. core's
  // pre-built dist), so `instanceof` would falsely return false.
  return (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    (err as { response?: { status?: number } }).response?.status === 404
  );
}

function quoteIfNeeded(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

function unsupportedAggregate(req: AggregateRequest): Error {
  const field = req.field ? ` field=${req.field}` : '';
  return new Error(
    `GitHub aggregate: unsupported ${req.fn} for resource=${req.resource}${field}`,
  );
}

function filterConditions(
  filter: FilterClause[] | undefined,
): FilterCondition[] {
  if (!filter) {
    return [];
  }
  const out: FilterCondition[] = [];
  for (const clause of filter) {
    if ('or' in clause) {
      throw new Error(
        'GitHub aggregate count: OR filters are not supported (GitHub search would silently turn them into AND)',
      );
    }
    out.push(clause);
  }
  return out;
}
