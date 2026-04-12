import { GitHubActionsConnector } from '@rawdash/github';
import { serve } from '@rawdash/server';

serve(
  {
    connectors: [
      {
        connector: GitHubActionsConnector,
        config: {
          owner: process.env['GITHUB_OWNER'] ?? 'rawdash',
          repo: process.env['GITHUB_REPO'] ?? 'rawdash',
          token: process.env['GITHUB_TOKEN'] ?? '',
        },
      },
    ],
  },
  { port: 8080 },
);
