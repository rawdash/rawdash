import { defineConnector } from '@rawdash/core';

export type GitHubActionsConfig = {
  owner: string;
  repo: string;
  token: string;
};

type GitHubRunsResponse = {
  workflow_runs: Array<{
    id: number;
    name: string;
    conclusion: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    run_attempt: number;
  }>;
};

const MAX_LOOKBACK_DAYS = 90;

export const GitHubActionsConnector = defineConnector<GitHubActionsConfig>()({
  id: 'github-actions',

  resources: {
    workflow_run: {
      fields: {
        id: { type: 'number' },
        name: { type: 'string' },
        conclusion: { type: 'string' },
        status: { type: 'string' },
        created_at: { type: 'timestamp' },
        updated_at: { type: 'timestamp' },
        run_attempt: { type: 'number' },
      },
    },
  },

  async sync({ config, storage }) {
    const { owner, repo, token } = config;

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    const cutoff = Date.now() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const allRuns: Array<{
      id: number;
      name: string;
      conclusion: string;
      status: string;
      created_at: string;
      updated_at: string;
      run_attempt: number;
    }> = [];
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

      if (new Date(runs.at(-1)!.created_at).getTime() < cutoff) {
        break;
      }

      page++;
    }

    await storage.upsert('workflow_run', allRuns);
  },
});
