import {
  BaseConnector,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
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

  private async syncWorkflowRuns(
    storage: StorageHandle,
    request: SyncOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    const { owner, repo } = this.settings;
    const headers = this.buildHeaders();

    if (request.mode === 'latest') {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=1`,
        { headers, signal },
      );
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as GitHubRunsResponse;
      const run = data.workflow_runs[0];
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

    const cutoff = request.since ? new Date(request.since).getTime() : null;
    const allEvents: Parameters<StorageHandle['events']>[0] = [];
    let page = 1;

    while (true) {
      signal?.throwIfAborted();
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=100&page=${page}`,
        { headers, signal },
      );
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as GitHubRunsResponse;
      const runs = data.workflow_runs;
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
        break;
      }
      page++;
    }

    await storage.events(allEvents, { names: ['workflow_run'] });
  }

  private async syncPullRequests(
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void> {
    const { owner, repo } = this.settings;
    const headers = this.buildHeaders();
    const allPRs: GitHubPR[] = [];
    let page = 1;

    while (true) {
      signal?.throwIfAborted();
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100&page=${page}`,
        { headers, signal },
      );
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const prs = (await res.json()) as GitHubPR[];
      if (prs.length === 0) {
        break;
      }
      allPRs.push(...prs);
      if (prs.length < 100) {
        break;
      }
      page++;
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
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/reviews`,
        { headers, signal },
      );
      if (!res.ok) {
        throw new Error(
          `GitHub API error fetching reviews for PR #${pr.number}: ${res.status} ${res.statusText}`,
        );
      }
      const reviews = (await res.json()) as GitHubReview[];
      for (const review of reviews) {
        if (!review.user) {
          continue;
        }
        reviewEdges.push({
          from_type: 'pull_request',
          from_id: String(pr.number),
          kind: 'reviewed_by',
          to_type: 'user',
          to_id: review.user.login,
          attributes: {
            state: review.state,
          },
          updated_at: new Date(review.submitted_at).getTime(),
        });
      }
    }

    await storage.edges(reviewEdges, { kinds: ['reviewed_by'] });
  }

  private async syncIssues(
    storage: StorageHandle,
    request: SyncOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    const { owner, repo } = this.settings;
    const headers = this.buildHeaders();
    const allIssues: GitHubIssue[] = [];
    let page = 1;

    while (true) {
      signal?.throwIfAborted();
      const url = new URL(
        `https://api.github.com/repos/${owner}/${repo}/issues`,
      );
      url.searchParams.set('state', 'all');
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      if (request.since) {
        url.searchParams.set('since', request.since);
      }
      const res = await fetch(url.toString(), { headers, signal });
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const issues = (await res.json()) as GitHubIssue[];
      if (issues.length === 0) {
        break;
      }
      for (const issue of issues) {
        if (issue.pull_request !== undefined) {
          continue;
        }
        allIssues.push(issue);
      }
      if (issues.length < 100) {
        break;
      }
      page++;
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
    const headers = this.buildHeaders();
    const allDeployments: GitHubDeployment[] = [];
    let page = 1;

    while (true) {
      signal?.throwIfAborted();
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/deployments?per_page=100&page=${page}`,
        { headers, signal },
      );
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const deployments = (await res.json()) as GitHubDeployment[];
      if (deployments.length === 0) {
        break;
      }
      allDeployments.push(...deployments);
      if (deployments.length < 100) {
        break;
      }
      page++;
    }

    const entities: Parameters<StorageHandle['entities']>[0] = [];
    for (const deployment of allDeployments) {
      signal?.throwIfAborted();
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/deployments/${deployment.id}/statuses?per_page=1`,
        { headers, signal },
      );
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const statuses = (await res.json()) as GitHubDeploymentStatus[];
      const createdMs = new Date(deployment.created_at).getTime();
      const statusUpdatedMs = statuses[0]?.updated_at
        ? new Date(statuses[0].updated_at).getTime()
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
          latest_status: statuses[0]?.state ?? 'unknown',
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
    const headers = this.buildHeaders();
    const allReleases: GitHubRelease[] = [];
    let page = 1;

    while (true) {
      signal?.throwIfAborted();
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100&page=${page}`,
        { headers, signal },
      );
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const releases = (await res.json()) as GitHubRelease[];
      if (releases.length === 0) {
        break;
      }
      allReleases.push(...releases);
      if (releases.length < 100) {
        break;
      }
      page++;
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
    const headers = this.buildHeaders();

    const contributors = await this.withRetry<GitHubContributorStats[]>(
      async (sig) => {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/stats/contributors`,
          { headers, signal: sig },
        );
        if (res.status === 202) {
          return { status: 'retry' };
        }
        if (!res.ok) {
          throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
        }
        return {
          status: 'done',
          value: (await res.json()) as GitHubContributorStats[],
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
    const headers = this.buildHeaders();
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
      signal,
    });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as GitHubRepo;
    await storage.entities(
      [
        {
          type: 'repo',
          id: `${owner}/${repo}`,
          attributes: {
            stars: data.stargazers_count,
            forks: data.forks_count,
            watchers: data.subscribers_count,
          },
          updated_at: Date.now(),
        },
      ],
      { types: ['repo'] },
    );
  }

  async sync(
    request: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.syncRepoStats(storage, signal);
    await this.syncWorkflowRuns(storage, request, signal);
    await this.syncPullRequests(storage, signal);
    await this.syncIssues(storage, request, signal);
    await this.syncDeployments(storage, signal);
    await this.syncReleases(storage, signal);
    await this.syncContributors(storage, signal);
  }
}
