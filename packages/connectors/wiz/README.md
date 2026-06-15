<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-wiz

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-wiz)](https://www.npmjs.com/package/@rawdash/connector-wiz)
[![license](https://img.shields.io/npm/l/@rawdash/connector-wiz)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync cloud-security issues, issue lifecycle events, and vulnerability findings from a Wiz tenant for open-critical, MTTR, and posture dashboards.

## Install

```sh
npm install @rawdash/connector-wiz
```

## Authentication

OAuth 2.0 client-credentials flow against a Wiz service account. The connector mints an access token, refreshes it on expiry, and sends it as a Bearer header on every GraphQL request.

1. In the Wiz portal, open Settings -> Service Accounts and create a new service account.
2. Grant it the read scopes for the resources you intend to sync (typically read:issues and read:vulnerabilities).
3. Copy the Client ID, Client Secret, and Token Endpoint shown on the service-account page.
4. Copy the GraphQL API endpoint shown on the same page (e.g. "https://api.us1.app.wiz.io/graphql"); the region segment is tenant-specific.
5. Store the client secret as a rawdash secret and reference it from the connector config as `clientSecret: secret("WIZ_CLIENT_SECRET")`.

## Configuration

| Field           | Type   | Required | Description                                                                                                                                                            |
| --------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiEndpoint`   | string | Yes      | Tenant-specific Wiz GraphQL endpoint shown on the Wiz service-account page (e.g. "https://api.us1.app.wiz.io/graphql"). The region segment changes per data residency. |
| `clientId`      | string | Yes      | Client ID of the Wiz service account authorized for the API.                                                                                                           |
| `clientSecret`  | secret | Yes      | Client secret of the Wiz service account. Stored as a secret.                                                                                                          |
| `tokenEndpoint` | string | No       | Override the OAuth 2.0 token endpoint. Defaults to https://auth.app.wiz.io/oauth/token; use the gov / fed equivalent for non-commercial deployments.                   |
| `audience`      | string | No       | OAuth audience claim requested when minting the access token. Defaults to "wiz-api"; some legacy tenants require "beyond-api".                                         |
| `resources`     | array  | No       | Which Wiz resources to sync. Omit to sync all of them. The issues and issue_events resources share the same underlying GraphQL query.                                  |

## Resources

- **`wiz_issue`** _(entity)_ - Wiz issues (cloud-configuration, toxic-combination, and threat-detection findings) keyed by issue id, with severity, status, the offending entity snapshot, and lifecycle timestamps.
  - Endpoint: `GraphQL query: issues { nodes { ... } }`
  - Paginated via the GraphQL connection cursor; incremental syncs filter on updatedAt.after and stop once a page is entirely older than options.since.
  - `severity`: CRITICAL, HIGH, MEDIUM, LOW, or INFORMATIONAL.
  - `status`: OPEN, IN_PROGRESS, RESOLVED, REJECTED.
  - `issueType`: Issue category (e.g. CLOUD_CONFIGURATION, TOXIC_COMBINATION).
  - `ruleName`: Name of the source rule that produced the issue.
  - `resourceName`: Name of the cloud resource the issue applies to.
  - `resourceType`: Type of the cloud resource (e.g. EC2_INSTANCE, S3_BUCKET).
  - `cloudProvider`: AWS, GCP, AZURE, etc.
  - `createdAt`: When Wiz first opened the issue (Unix ms).
  - `resolvedAt`: When the issue was resolved (Unix ms; null if open).
  - `dueAt`: Remediation due date as configured by SLA (Unix ms).
- **`wiz_issue_event`** _(event)_ - Issue lifecycle events derived from each Wiz issue: one event at createdAt (kind="opened") and, when present, one at resolvedAt (kind="resolved"). Used to build open-rate, resolution-rate, and MTTR widgets.
  - Endpoint: `GraphQL query: issues { nodes { ... } } (derived)`
  - Events are derived from the same issues GraphQL query; enabling issue_events without issues still triggers the query but skips the entity write.
  - `kind`: "opened" or "resolved".
  - `issueId`: The Wiz issue id this lifecycle event belongs to.
  - `severity`: Severity of the originating issue at sync time.
  - `cloudProvider`: Cloud provider of the affected resource.
- **`wiz_vulnerability`** _(entity)_ - Wiz vulnerability findings keyed by finding id, with CVE id, severity, status, first / last detection timestamps, and the affected asset.
  - Endpoint: `GraphQL query: vulnerabilityFindings { nodes { ... } }`
  - Paginated via the GraphQL connection cursor; incremental syncs filter on lastDetectedAt.after.
  - `severity`: CRITICAL, HIGH, MEDIUM, LOW, or INFORMATIONAL.
  - `status`: OPEN, RESOLVED, IGNORED, IN_PROGRESS.
  - `name`: Vulnerability name as reported by Wiz.
  - `cve`: Vulnerability external id, typically a CVE identifier.
  - `assetName`: Name of the affected asset.
  - `assetType`: Type of the affected asset.
  - `cloudPlatform`: Cloud platform hosting the affected asset.
  - `firstDetectedAt`: When the vulnerability was first detected (Unix ms).
  - `lastDetectedAt`: When the vulnerability was last detected (Unix ms).
  - `resolvedAt`: When the vulnerability was resolved (Unix ms; null if open).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const wiz = {
  name: 'wiz',
  connectorId: 'wiz',
  config: {
    apiEndpoint: 'https://api.us1.app.wiz.io/graphql',
    clientId: 'aaaa-bbbb-cccc-dddd',
    clientSecret: secret('WIZ_CLIENT_SECRET'),
  },
};

export default defineConfig({
  connectors: [wiz],
  dashboards: {
    security: defineDashboard({
      widgets: {
        open_criticals: {
          kind: 'stat',
          title: 'Open critical issues',
          metric: defineMetric({
            connector: wiz,
            shape: 'entity',
            entityType: 'wiz_issue',
            fn: 'count',
            filter: [
              { field: 'status', op: 'eq', value: 'OPEN' },
              { field: 'severity', op: 'eq', value: 'CRITICAL' },
            ],
          }),
        },
        resolved_per_day: {
          kind: 'timeseries',
          title: 'Issues resolved per day',
          window: '30d',
          metric: defineMetric({
            connector: wiz,
            shape: 'event',
            name: 'wiz_issue_event',
            fn: 'count',
            filter: [{ field: 'kind', op: 'eq', value: 'resolved' }],
          }),
        },
      },
    }),
  },
});
```

## Limitations

- Issue lifecycle events are derived from each issue's createdAt / resolvedAt timestamps, not from a dedicated audit-log endpoint, so administrative reopen / re-resolve transitions inside the same sync window are collapsed to the latest state.
- Service-account auth only; per-user OAuth is out of scope.
- Cloud-configuration and threat-detection issues are returned by the same /issues query and are not segmented at the connector layer; filter on the `issueType` attribute downstream.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Wiz API docs](https://win.wiz.io/reference/welcome)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
