import {
  BaseConnector,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
  defineConfigFields,
} from '@rawdash/core';
import {
  type HttpRequest,
  type HttpResponse,
  githubRateLimit,
  paginateLink,
  request,
} from '@rawdash/http-client';
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

  private async *paginate<T>(
    url: string,
    signal?: AbortSignal,
  ): AsyncIterable<T> {
    yield* paginateLink<T>(
      {
        url,
        headers: this.buildHeaders(),
        signal,
        rateLimit: githubRateLimit,
      },
      (body) => body as T[],
    );
  }

  private async syncWorkflowRuns(
    storage: StorageHandle,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    const { owner, repo } = this.settings;

    if (options.mode === 'latest') {
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
      return;
    }

    const cutoff = options.since ? new Date(options.since).getTime() : null;
    const allEvents: Parameters<StorageHandle['events']>[0] = [];

    const iter = paginateLink<GitHubRunsResponse>(
      {
        url: `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=100`,
        headers: this.buildHeaders(),
        signal,
        rateLimit: githubRateLimit,
      },
      (body) => [body as GitHubRunsResponse],
    );

    let stop = false;
    for await (const page of iter) {
      signal?.throwIfAborted();
      const runs = page.workflow_runs;
      if (runs.length === 0) {
        break;
      }

      for (const run of runs) {
        const createdMs = new Date(run.created_at).getTime();
        const updatedMs = new Date(run.updated_at).getTime();
        if (cutoff !== null && createdMs < cutoff && updatedMs < cutoff) {
          continue;
        }
        allEvents.push({
          name: 'workflow_run',
          start_ts: createdMs,
          end_ts: updatedMs,
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

      const lastRun = runs.at(-1)!;
      if (
        cutoff !== null &&
        new Date(lastRun.created_at).getTime() < cutoff &&
        new Date(lastRun.updated_at).getTime() < cutoff
      ) {
        stop = true;
      }
      if (stop) {
        break;
      }
    }

    await storage.events(allEvents, { names: ['workflow_run'] });
  }

  private async syncPullRequests(
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void> {
    const { owner, repo } = this.settings;
    const allPRs: GitHubPR[] = [];

    for await (const pr of this.paginate<GitHubPR>(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100`,
      signal,
    )) {
      allPRs.push(pr);
    }

    await storage.entities(
      allPRs.map((pr) => ({
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
      })),
      { types: ['pull_request'] },
    );

    const reviewEdges: Parameters<StorageHandle['edges']>[0] = [];
    for (const pr of allPRs) {
      signal?.throwIfAborted();
      const res = await this.get<GitHubReview[]>(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/reviews`,
        signal,
      );
      for (const review of res.body) {
        if (!review.user) {
          continue;
        }
        reviewEdges.push({
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

    await storage.edges(reviewEdges, { kinds: ['reviewed_by'] });
  }

  private async syncIssues(
    storage: StorageHandle,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    const { owner, repo } = this.settings;
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
    url.searchParams.set('state', 'all');
    url.searchParams.set('per_page', '100');
    if (options.since) {
      url.searchParams.set('since', options.since);
    }

    const allIssues: GitHubIssue[] = [];
    for await (const issue of this.paginate<GitHubIssue>(
      url.toString(),
      signal,
    )) {
      if (issue.pull_request !== undefined) {
        continue;
      }
      allIssues.push(issue);
    }

    await storage.entities(
      allIssues.map((issue) => ({
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
      })),
      { types: ['issue'] },
    );
  }

  private async syncDeployments(
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void> {
    const { owner, repo } = this.settings;
    const allDeployments: GitHubDeployment[] = [];
    for await (const d of this.paginate<GitHubDeployment>(
      `https://api.github.com/repos/${owner}/${repo}/deployments?per_page=100`,
      signal,
    )) {
      allDeployments.push(d);
    }

    const entities: Parameters<StorageHandle['entities']>[0] = [];
    for (const deployment of allDeployments) {
      signal?.throwIfAborted();
      const res = await this.get<GitHubDeploymentStatus[]>(
        `https://api.github.com/repos/${owner}/${repo}/deployments/${deployment.id}/statuses?per_page=1`,
        signal,
      );
      const createdMs = new Date(deployment.created_at).getTime();
      const statusUpdatedMs = res.body[0]?.updated_at
        ? new Date(res.body[0].updated_at).getTime()
        : null;
      entities.push({
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

    await storage.entities(entities, { types: ['deployment'] });
  }

  private async syncReleases(
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void> {
    const { owner, repo } = this.settings;
    const allReleases: GitHubRelease[] = [];
    for await (const r of this.paginate<GitHubRelease>(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`,
      signal,
    )) {
      allReleases.push(r);
    }

    await storage.entities(
      allReleases.map((release) => ({
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
      })),
      { types: ['release'] },
    );
  }

  private async syncContributors(
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void> {
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
      return;
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
  }

  private async syncRepoStats(
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void> {
    const { owner, repo } = this.settings;
    const res = await this.get<GitHubRepo>(
      `https://api.github.com/repos/${owner}/${repo}`,
      signal,
    );
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
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.syncRepoStats(storage, signal);
    await this.syncWorkflowRuns(storage, options, signal);
    await this.syncPullRequests(storage, signal);
    await this.syncIssues(storage, options, signal);
    await this.syncDeployments(storage, signal);
    await this.syncReleases(storage, signal);
    await this.syncContributors(storage, signal);
  }
}
