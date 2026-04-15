import { defineConnector } from '@rawdash/core';

export type GitHubActionsConfig = {
  owner: string;
  repo: string;
  token: string;
  /**
   * How many days of workflow run history to fetch on each sync.
   * When omitted, all available history is fetched (runs until the API
   * returns no more pages).
   */
  lookbackDays?: number;
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
    const { owner, repo, token, lookbackDays } = config;

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    const cutoff =
      lookbackDays !== undefined
        ? Date.now() - lookbackDays * 24 * 60 * 60 * 1000
        : null;
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
  },
});
