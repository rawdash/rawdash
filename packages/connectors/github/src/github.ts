import {
  type HttpResponse,
  githubRateLimit,
  parseLinkHeader,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type CredentialsSchema,
  type FetchPageResult,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
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

const PHASE_ORDER: readonly GitHubSyncPhase[] = [
  'repo_stats',
  'workflow_runs',
  'pull_requests',
  'issues',
  'deployments',
  'releases',
  'contributors',
];

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

function isGitHubSyncCursor(value: unknown): value is GitHubSyncCursor {
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

export class GitHubConnector extends BaseConnector<
  GitHubSettings,
  GitHubCredentials
> {
  static readonly id = 'github-actions';

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

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rawdash/connector-github (+https://rawdash.dev)',
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
    if (pageUrl === null) {
      return null;
    }
    const allowedPath = this.allowedPageBasePath(phase);
    if (allowedPath === null) {
      return null;
    }
    try {
      const u = new URL(pageUrl);
      if (
        u.protocol !== 'https:' ||
        u.host !== 'api.github.com' ||
        u.pathname !== allowedPath
      ) {
        return null;
      }
      return u.toString();
    } catch {
      return null;
    }
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
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const { owner, repo } = this.settings;
    const url =
      page ??
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100`;
    const res = await this.fetch<GitHubPR[]>(url, 'pull_requests', signal);
    const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    const prs = res.body;

    const reviewsByPR = new Map<number, GitHubReview[]>();
    for (const pr of prs) {
      signal?.throwIfAborted();
      const reviews = await this.fetch<GitHubReview[]>(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/reviews`,
        'pull_request_reviews',
        signal,
      );
      reviewsByPR.set(pr.number, reviews.body);
    }

    const items: PRPageItems[] = [{ prs, reviewsByPR }];
    return { items, next: nextLink };
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

    const latestStatusById = new Map<number, GitHubDeploymentStatus | null>();
    for (const deployment of deployments) {
      signal?.throwIfAborted();
      const statusRes = await this.fetch<GitHubDeploymentStatus[]>(
        `https://api.github.com/repos/${owner}/${repo}/deployments/${deployment.id}/statuses?per_page=1`,
        'deployment_statuses',
        signal,
      );
      latestStatusById.set(deployment.id, statusRes.body[0] ?? null);
    }

    const items: DeploymentPageItems[] = [{ deployments, latestStatusById }];
    return { items, next: nextLink };
  }

  private async fetchReleases(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchPageResult<string>> {
    const { owner, repo } = this.settings;
    const url =
      page ??
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`;
    const res = await this.fetch<GitHubRelease[]>(url, 'releases', signal);
    const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    return { items: res.body, next: nextLink };
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
    }
    const runs = items as GitHubRunsResponse['workflow_runs'];
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
  ): Promise<void> {
    if (page === null) {
      await storage.entities([], { types: ['pull_request'] });
      await storage.edges([], { kinds: ['reviewed_by'] });
    }
    const pageItems = items as PRPageItems[];
    for (const { prs, reviewsByPR } of pageItems) {
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
    const issues = items as GitHubIssue[];
    for (const issue of issues) {
      if (issue.pull_request !== undefined) {
        continue;
      }
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
  ): Promise<void> {
    if (page === null) {
      await storage.entities([], { types: ['deployment'] });
    }
    const pageItems = items as DeploymentPageItems[];
    for (const { deployments, latestStatusById } of pageItems) {
      for (const deployment of deployments) {
        const status = latestStatusById.get(deployment.id) ?? null;
        const createdMs = new Date(deployment.created_at).getTime();
        const statusUpdatedMs = status?.updated_at
          ? new Date(status.updated_at).getTime()
          : null;
        await storage.entity({
          type: 'deployment',
          id: String(deployment.id),
          attributes: {
            environment: deployment.environment,
            ref: deployment.ref,
            sha: deployment.sha,
            creator: deployment.creator?.login ?? '',
            created_at: createdMs,
            latest_status: status?.state ?? 'unknown',
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
    const releases = items as GitHubRelease[];
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
    const contributors = items as GitHubContributorStats[];
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
    return paginateChunked<GitHubSyncPhase, string>({
      phases: PHASE_ORDER,
      cursor,
      signal,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'repo_stats':
            return this.fetchRepoStats(sig);
          case 'workflow_runs':
            return options.mode === 'latest'
              ? this.fetchWorkflowRunsLatest(sig)
              : this.fetchWorkflowRunsFull(options, page, sig);
          case 'pull_requests':
            return this.fetchPullRequests(page, sig);
          case 'issues':
            return this.fetchIssues(options, page, sig);
          case 'deployments':
            return this.fetchDeployments(page, sig);
          case 'releases':
            return this.fetchReleases(page, sig);
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
            return this.writePullRequests(storage, items, page);
          case 'issues':
            return this.writeIssues(storage, items, page);
          case 'deployments':
            return this.writeDeployments(storage, items, page);
          case 'releases':
            return this.writeReleases(storage, items, page);
          case 'contributors':
            return this.writeContributors(storage, items);
        }
      },
    });
  }
}
