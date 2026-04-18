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
    created_at: string;
    updated_at: string;
    run_attempt: number;
  }>;
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

  readonly resources = {
    workflow_run: {
      fields: {
        id: { type: 'number' as const },
        name: { type: 'string' as const },
        conclusion: { type: 'string' as const },
        status: { type: 'string' as const },
        created_at: { type: 'timestamp' as const },
        updated_at: { type: 'timestamp' as const },
        run_attempt: { type: 'number' as const },
      },
    },
  };

  async sync(request: SyncRequest, storage: StorageHandle): Promise<void> {
    if (request.resource !== 'workflow_run') {
      return;
    }

    const { owner, repo } = this.settings;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (this.creds.token) {
      headers['Authorization'] = `Bearer ${this.creds.token}`;
    }

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
        await storage.upsert('workflow_run', [
          {
            id: run.id,
            name: run.name,
            conclusion: run.conclusion ?? 'unknown',
            status: run.status,
            created_at: run.created_at,
            updated_at: run.updated_at,
            run_attempt: run.run_attempt,
          },
        ]);
      }
      return;
    }

    const cutoff = request.since ? new Date(request.since).getTime() : null;
    const allRuns: Array<Record<string, unknown>> = [];
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

      if (runs.length === 0) {
        break;
      }

      for (const run of runs) {
        if (
          cutoff !== null &&
          new Date(run.created_at).getTime() < cutoff &&
          new Date(run.updated_at).getTime() < cutoff
        ) {
          continue;
        }
        allRuns.push({
          id: run.id,
          name: run.name,
          conclusion: run.conclusion ?? 'unknown',
          status: run.status,
          created_at: run.created_at,
          updated_at: run.updated_at,
          run_attempt: run.run_attempt,
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

    await storage.upsert('workflow_run', allRuns);
  }
}
