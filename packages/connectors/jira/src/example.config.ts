import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const jira = {
  name: 'jira',
  connectorId: 'jira',
  config: {
    email: 'you@yourorg.com',
    apiToken: secret('JIRA_API_TOKEN'),
    host: 'yourorg.atlassian.net',
    projectKeys: ['ENG'],
  },
};

export default defineConfig({
  connectors: [jira],
  dashboards: {
    delivery: defineDashboard({
      widgets: {
        open_issues: {
          kind: 'stat',
          title: 'Open Issues',
          metric: defineMetric({
            connector: jira,
            shape: 'entity',
            entityType: 'jira_issue',
            fn: 'count',
            filter: [{ field: 'statusCategory', op: 'neq', value: 'done' }],
          }),
        },
      },
    }),
  },
});
