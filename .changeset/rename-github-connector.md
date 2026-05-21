---
'@rawdash/connector-github': minor
---

Rename `GitHubActionsConnector` → `GitHubConnector` and `GitHubActionsSettings` → `GitHubSettings`. The connector's scope has expanded beyond GitHub Actions (it now syncs pull requests, issues, deployments, releases, and contributors), so the class name now matches the package name and the vendor-level naming used by sibling connectors (`StripeConnector`, `GA4Connector`).

Breaking:

- Replace `import { GitHubActionsConnector } from '@rawdash/connector-github'` with `import { GitHubConnector } from '@rawdash/connector-github'`.
- Replace `GitHubActionsSettings` with `GitHubSettings` if you import the settings type.

No behavior change. The connector's storage `id` is unchanged (`github-actions`), so existing synced data and widget `source` strings continue to work without migration.
