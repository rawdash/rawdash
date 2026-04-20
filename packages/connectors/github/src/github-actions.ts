import {
  BaseConnector,
  type CredentialSchema,
  type StorageHandle,
  type SyncRequest,
} from '@rawdash/core';

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

const githubCredentials = {
  token: {
    description: 'GitHub personal access token',
    auth: 'optional' as const,
  },
} satisfies CredentialSchema;

type GitHubCredentials = typeof githubCredentials;

export class GitHubActionsConnector extends BaseConnector<
  GitHubActionsSettings,
  GitHubCredentials
> {
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
    request: SyncRequest,
  ): Promise<void> {
    const { owner, repo } = this.settings;
    const headers = this.buildHeaders();

    if (request.mode === 'latest') {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=1`,
        { headers },
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
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=100&page=${page}`,
        { headers },
      );
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as GitHubRunsResponse;
      const runs = data.workflow_runs;
      if (runs.length === 0) {break;}

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

    await storage.events(allEvents);
  }

  private async syncPullRequests(storage: StorageHandle): Promise<void> {
    const { owner, repo } = this.settings;
    const headers = this.buildHeaders();
    const allPRs: GitHubPR[] = [];
    let page = 1;

    while (true) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100&page=${page}`,
        { headers },
      );
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const prs = (await res.json()) as GitHubPR[];
      if (prs.length === 0) {break;}
      allPRs.push(...prs);
      if (prs.length < 100) {break;}
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
    );

    const reviewEdges: Parameters<StorageHandle['edges']>[0] = [];
    const reviewBatch = allPRs.slice(0, 20);
    for (const pr of reviewBatch) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/reviews`,
        { headers },
      );
      if (!res.ok) {continue;}
      const reviews = (await res.json()) as GitHubReview[];
      for (const review of reviews) {
        if (!review.user) {continue;}
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

    await storage.edges(reviewEdges);
  }

  async sync(request: SyncRequest, storage: StorageHandle): Promise<void> {
    await this.syncWorkflowRuns(storage, request);
    if (request.mode === 'full') {
      await this.syncPullRequests(storage);
    }
  }
}
