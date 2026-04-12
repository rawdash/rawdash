import type { ConnectorDef } from '@rawdash/core';

export type GitHubActionsConfig = {
  owner: string;
  repo: string;
  token: string;
};

export type GitHubActionsWidgets = {
  latest_run_conclusion: string;
  run_count_7d: number;
  success_rate_7d: number;
};

type GitHubRunsResponse = {
  workflow_runs: Array<{
    conclusion: string | null;
    created_at: string;
  }>;
};

export const GitHubActionsConnector: ConnectorDef<
  GitHubActionsConfig,
  GitHubActionsWidgets
> = {
  id: 'github-actions',

  widgets: {
    latest_run_conclusion: {
      description: 'Conclusion of the most recent workflow run',
    },
    run_count_7d: {
      description: 'Number of workflow runs in the last 7 days',
    },
    success_rate_7d: {
      description: 'Percentage of successful runs in the last 7 days (0–100)',
    },
  },

  async sync({ config, storage }) {
    const { owner, repo, token } = config;

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const allRuns: GitHubRunsResponse['workflow_runs'] = [];
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

      if (runs.length === 0) break;

      allRuns.push(...runs);

      if (new Date(runs.at(-1)!.created_at).getTime() < cutoff) break;

      page++;
    }

    const recentRuns = allRuns.filter(
      (r) => new Date(r.created_at).getTime() >= cutoff,
    );

    await storage.setWidget(
      'latest_run_conclusion',
      allRuns[0]?.conclusion ?? 'unknown',
    );

    await storage.setWidget('run_count_7d', recentRuns.length);

    const total = recentRuns.length;
    const successful = recentRuns.filter(
      (r) => r.conclusion === 'success',
    ).length;
    await storage.setWidget(
      'success_rate_7d',
      total > 0 ? Math.round((successful / total) * 100) : 0,
    );
  },
};
