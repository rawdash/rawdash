---
'@rawdash/connector-launchdarkly': patch
---

Fix LaunchDarkly feature flags losing all per-environment state under the current REST API version. The connector now sends `LD-API-Version: 20240415` on every request and, before fetching flags for a project, enumerates that project's environments (`GET /api/v2/projects/{projectKey}/environments`) so it can pass each environment key as an `env` filter on the flags query. Under API version `20240415` (the default for access tokens created since April 2024, and mandatory once `20220603` reaches end of life on 2026-12-31), `GET /api/v2/flags/{projectKey}` only returns the per-flag `environments` object when the request is filtered by environment; without the `env` filter the connector was silently writing every flag with an empty `environments` map and collapsing each flag's `updated_at` to its creation date. Also reduces the audit-log page size from 50 to 20, the endpoint's documented maximum.
