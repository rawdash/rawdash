import {
  type HttpRequest,
  type HttpResponse,
  githubRateLimit,
  parseLinkHeader,
  request,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
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

export interface GitHubActionsSettings {
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

interface GitHubSyncCursor {
  phase: GitHubSyncPhase;
  pageUrl?: string;
}

const PHASE_ORDER: readonly GitHubSyncPhase[] = [
  'repo_stats',
  'workflow_runs',
  'pull_requests',
  'issues',
  'deployments',
  'releases',
  'contributors',
];

type PhaseResult = { done: true } | { done: false; pageUrl: string };

function isGitHubSyncCursor(value: unknown): value is GitHubSyncCursor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { phase?: unknown; pageUrl?: unknown };
  if (typeof v.phase !== 'string') {
    return false;
  }
  if (!(PHASE_ORDER as readonly string[]).includes(v.phase)) {
    return false;
  }
  if (v.pageUrl !== undefined && typeof v.pageUrl !== 'string') {
    return false;
  }
  return true;
}

export class GitHubActionsConnector extends BaseConnector<
  GitHubActionsSettings,
  GitHubCredentials
> {
  static readonly id = 'github-actions';

  static create(input: unknown): GitHubActionsConnector {
    const parsed = configFields.parse(input);
    return new GitHubActionsConnector(
      { owner: parsed.owner, repo: parsed.repo },
      { token: parsed.token },
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

  private get<T>(url: string, signal?: AbortSignal): Promise<HttpResponse<T>> {
    const req: HttpRequest = {
      url,
      headers: this.buildHeaders(),
      signal,
      rateLimit: githubRateLimit,
    };
    return request<T>(req);
  }

  private async syncRepoStats(
    storage: StorageHandle,
    initialPageUrl: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const { owner, repo } = this.settings;
    const url =
      initialPageUrl ?? `https://api.github.com/repos/${owner}/${repo}`;
    const res = await this.get<GitHubRepo>(url, signal);
    await storage.entities(
      [
        {
          type: 'repo',
          id: `${owner}/${repo}`,
          attributes: {
            stars: res.body.stargazers_count,
            forks: res.body.forks_count,
            watchers: res.body.subscribers_count,
          },
          updated_at: Date.now(),
        },
      ],
      { types: ['repo'] },
    );
    return { done: true };
  }

  private async syncWorkflowRunsLatest(
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const { owner, repo } = this.settings;
    const res = await this.get<GitHubRunsResponse>(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=1`,
      signal,
    );
    const run = res.body.workflow_runs[0];
    if (run) {
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
    return { done: true };
  }

  private async syncWorkflowRunsFull(
    storage: StorageHandle,
    options: SyncOptions,
    initialPageUrl: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const { owner, repo } = this.settings;
    const cutoff = options.since ? new Date(options.since).getTime() : null;

    if (initialPageUrl === undefined) {
      await storage.events([], { names: ['workflow_run'] });
    }

    let nextUrl: string | null =
      initialPageUrl ??
      `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=100`;

    while (nextUrl) {
      if (signal?.aborted) {
        return { done: false, pageUrl: nextUrl };
      }
      const res: HttpResponse<GitHubRunsResponse> =
        await this.get<GitHubRunsResponse>(nextUrl, signal);
      const body = res.body;
      const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
      const runs = body.workflow_runs;
      if (runs.length === 0) {
        return { done: true };
      }

      const pageEvents = runs
        .filter((run) => {
          if (cutoff === null) {
            return true;
          }
          const createdMs = new Date(run.created_at).getTime();
          const updatedMs = new Date(run.updated_at).getTime();
          return !(createdMs < cutoff && updatedMs < cutoff);
        })
        .map((run) => ({
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
        }));

      for (const e of pageEvents) {
        await storage.event(e);
      }

      const lastRun = runs.at(-1)!;
      if (
        cutoff !== null &&
        new Date(lastRun.created_at).getTime() < cutoff &&
        new Date(lastRun.updated_at).getTime() < cutoff
      ) {
        return { done: true };
      }

      nextUrl = nextLink;
    }

    return { done: true };
  }

  private async syncPullRequests(
    storage: StorageHandle,
    initialPageUrl: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const { owner, repo } = this.settings;

    if (initialPageUrl === undefined) {
      await storage.entities([], { types: ['pull_request'] });
      await storage.edges([], { kinds: ['reviewed_by'] });
    }

    let nextUrl: string | null =
      initialPageUrl ??
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100`;

    while (nextUrl) {
      if (signal?.aborted) {
        return { done: false, pageUrl: nextUrl };
      }
      const res: HttpResponse<GitHubPR[]> = await this.get<GitHubPR[]>(
        nextUrl,
        signal,
      );
      const body = res.body;
      const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
      if (body.length === 0) {
        return { done: true };
      }

      for (const pr of body) {
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

      for (const pr of body) {
        if (signal?.aborted) {
          return { done: false, pageUrl: nextUrl };
        }
        const res = await this.get<GitHubReview[]>(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/reviews`,
          signal,
        );
        for (const review of res.body) {
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

      nextUrl = nextLink;
    }

    return { done: true };
  }

  private async syncIssues(
    storage: StorageHandle,
    options: SyncOptions,
    initialPageUrl: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const { owner, repo } = this.settings;

    if (initialPageUrl === undefined) {
      await storage.entities([], { types: ['issue'] });
    }

    let nextUrl: string | null;
    if (initialPageUrl) {
      nextUrl = initialPageUrl;
    } else {
      const url = new URL(
        `https://api.github.com/repos/${owner}/${repo}/issues`,
      );
      url.searchParams.set('state', 'all');
      url.searchParams.set('per_page', '100');
      if (options.since) {
        url.searchParams.set('since', options.since);
      }
      nextUrl = url.toString();
    }

    while (nextUrl) {
      if (signal?.aborted) {
        return { done: false, pageUrl: nextUrl };
      }
      const res: HttpResponse<GitHubIssue[]> = await this.get<GitHubIssue[]>(
        nextUrl,
        signal,
      );
      const body = res.body;
      const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
      if (body.length === 0) {
        return { done: true };
      }

      for (const issue of body) {
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

      nextUrl = nextLink;
    }

    return { done: true };
  }

  private async syncDeployments(
    storage: StorageHandle,
    initialPageUrl: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const { owner, repo } = this.settings;

    if (initialPageUrl === undefined) {
      await storage.entities([], { types: ['deployment'] });
    }

    let nextUrl: string | null =
      initialPageUrl ??
      `https://api.github.com/repos/${owner}/${repo}/deployments?per_page=100`;

    while (nextUrl) {
      if (signal?.aborted) {
        return { done: false, pageUrl: nextUrl };
      }
      const res: HttpResponse<GitHubDeployment[]> = await this.get<
        GitHubDeployment[]
      >(nextUrl, signal);
      const body = res.body;
      const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
      if (body.length === 0) {
        return { done: true };
      }

      for (const deployment of body) {
        if (signal?.aborted) {
          return { done: false, pageUrl: nextUrl };
        }
        const res = await this.get<GitHubDeploymentStatus[]>(
          `https://api.github.com/repos/${owner}/${repo}/deployments/${deployment.id}/statuses?per_page=1`,
          signal,
        );
        const createdMs = new Date(deployment.created_at).getTime();
        const statusUpdatedMs = res.body[0]?.updated_at
          ? new Date(res.body[0].updated_at).getTime()
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
            latest_status: res.body[0]?.state ?? 'unknown',
          },
          updated_at: Math.max(createdMs, statusUpdatedMs ?? 0),
        });
      }

      nextUrl = nextLink;
    }

    return { done: true };
  }

  private async syncReleases(
    storage: StorageHandle,
    initialPageUrl: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const { owner, repo } = this.settings;

    if (initialPageUrl === undefined) {
      await storage.entities([], { types: ['release'] });
    }

    let nextUrl: string | null =
      initialPageUrl ??
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`;

    while (nextUrl) {
      if (signal?.aborted) {
        return { done: false, pageUrl: nextUrl };
      }
      const res: HttpResponse<GitHubRelease[]> = await this.get<
        GitHubRelease[]
      >(nextUrl, signal);
      const body = res.body;
      const nextLink = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
      if (body.length === 0) {
        return { done: true };
      }

      for (const release of body) {
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

      nextUrl = nextLink;
    }

    return { done: true };
  }

  private async syncContributors(
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const { owner, repo } = this.settings;

    const contributors = await this.withRetry<GitHubContributorStats[]>(
      async (sig) => {
        const res = await this.get<GitHubContributorStats[] | null>(
          `https://api.github.com/repos/${owner}/${repo}/stats/contributors`,
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

    if (!contributors || contributors.length === 0) {
      if (!contributors) {
        console.warn(
          '[github-actions] Stats endpoint never became ready — skipping contributor sync and keeping previous data.',
        );
      }
      return { done: true };
    }

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
    return { done: true };
  }

  private async runPhase(
    phase: GitHubSyncPhase,
    storage: StorageHandle,
    options: SyncOptions,
    initialPageUrl: string | undefined,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    switch (phase) {
      case 'repo_stats':
        return this.syncRepoStats(storage, initialPageUrl, signal);
      case 'workflow_runs':
        return options.mode === 'latest'
          ? this.syncWorkflowRunsLatest(storage, signal)
          : this.syncWorkflowRunsFull(storage, options, initialPageUrl, signal);
      case 'pull_requests':
        return this.syncPullRequests(storage, initialPageUrl, signal);
      case 'issues':
        return this.syncIssues(storage, options, initialPageUrl, signal);
      case 'deployments':
        return this.syncDeployments(storage, initialPageUrl, signal);
      case 'releases':
        return this.syncReleases(storage, initialPageUrl, signal);
      case 'contributors':
        return this.syncContributors(storage, signal);
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const incoming = isGitHubSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const startIdx = incoming ? PHASE_ORDER.indexOf(incoming.phase) : 0;

    for (let i = startIdx; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i]!;
      const initialPageUrl = i === startIdx ? incoming?.pageUrl : undefined;
      const result = await this.runPhase(
        phase,
        storage,
        options,
        initialPageUrl,
        signal,
      );
      if (!result.done) {
        return {
          done: false,
          cursor: { phase, pageUrl: result.pageUrl } satisfies GitHubSyncCursor,
        };
      }
    }

    return { done: true };
  }
}
