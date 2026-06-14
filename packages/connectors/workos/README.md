<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-workos

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-workos)](https://www.npmjs.com/package/@rawdash/connector-workos)
[![license](https://img.shields.io/npm/l/@rawdash/connector-workos)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync organizations, SSO connections, directory-sync directories, and authentication events from a WorkOS workspace for B2B SaaS onboarding and SSO-activity dashboards.

## Install

```sh
npm install @rawdash/connector-workos
```

## Authentication

A WorkOS API key (server-side, starts with `sk_`) is required. It is sent as a bearer token on every request and never leaves the workspace.

1. Sign in to the WorkOS Dashboard and switch to the environment (Sandbox or Production) you want to sync.
2. Open API Keys in the left navigation.
3. Create a new secret key (or copy an existing one). WorkOS only shows the secret once on creation.
4. Store it as a rawdash secret and reference it from the connector config as `apiKey: secret("WORKOS_API_KEY")`.

## Configuration

| Field                    | Type   | Required | Description                                                                                                                                |
| ------------------------ | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiKey`                 | secret | Yes      | WorkOS API key (server-side, starts with `sk_`). Used as a bearer token on every request. Read-only access is sufficient for sync.         |
| `resources`              | array  | No       | Which WorkOS resources to sync. Omit to sync all of them.                                                                                  |
| `authEventsLookbackDays` | number | No       | On a full sync (and when no incremental cursor is available), how many days of authentication events to fetch. Defaults to 30. Caps at 90. |

## Resources

- **`workos_organization`** _(entity)_ - WorkOS organizations (tenants) with their display name, domains, and creation timestamp.
  - Endpoint: `GET /organizations`
  - `name`: Organization display name.
  - `domains`: Comma-separated list of domains attached to the organization.
  - `createdAt`: When the organization was created (Unix ms).
- **`workos_connection`** _(entity)_ - WorkOS SSO connections (one per identity provider per organization) with their type, state, and parent organization.
  - Endpoint: `GET /connections`
  - `connectionType`: Connection type (e.g. OktaSAML, AzureSAML, GoogleOAuth).
  - `organizationId`: WorkOS organization that owns the connection.
  - `state`: Lifecycle state (active, inactive, draft, linked, unlinked).
  - `name`: Connection display name.
  - `createdAt`: When the connection was created (Unix ms).
- **`workos_directory`** _(entity)_ - WorkOS directory-sync directories (SCIM/HRIS feeds) with their type, state, and parent organization.
  - Endpoint: `GET /directories`
  - `directoryType`: Directory provider type (e.g. okta scim v2.0, azure scim v2.0, bamboohr).
  - `organizationId`: WorkOS organization that owns the directory.
  - `state`: Lifecycle state (active, inactive, validating, linked, unlinked).
  - `name`: Directory display name.
  - `createdAt`: When the directory was created (Unix ms).
- **`workos_auth_event`** _(event)_ - Authentication events from the WorkOS Events API (SSO, OAuth, password, magic auth, and MFA sign-in successes and failures).
  - Endpoint: `GET /events`
  - Filtered to the authentication.\* event family. Incremental syncs pass `range_start` so only events newer than the watermark are returned.
  - `eventType`: WorkOS event name (authentication.sso_succeeded, etc).
  - `outcome`: "succeeded" or "failed" derived from the event suffix.
  - `method`: Authentication method (sso, oauth, password, magic_auth, mfa, email_verification).
  - `organizationId`: WorkOS organization the event belongs to (may be null).
  - `userId`: WorkOS user id involved in the event (may be null).
  - `connectionId`: WorkOS connection id used for the event (may be null).
  - `connectionType`: Connection type used for the event (may be null for non-SSO methods).
  - `ipAddress`: Client IP captured by WorkOS (may be null).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const workos = {
  name: 'workos',
  connectorId: 'workos',
  config: {
    apiKey: secret('WORKOS_API_KEY'),
  },
};

export default defineConfig({
  connectors: [workos],
  dashboards: {
    enterprise_auth: defineDashboard({
      widgets: {
        organizations: {
          kind: 'stat',
          title: 'Organizations',
          metric: defineMetric({
            connector: workos,
            shape: 'entity',
            entityType: 'workos_organization',
            fn: 'count',
          }),
        },
        active_connections: {
          kind: 'stat',
          title: 'Active SSO connections',
          metric: defineMetric({
            connector: workos,
            shape: 'entity',
            entityType: 'workos_connection',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'active' }],
          }),
        },
        sso_failures: {
          kind: 'stat',
          title: 'Failed SSO sign-ins',
          metric: defineMetric({
            connector: workos,
            shape: 'event',
            name: 'workos_auth_event',
            fn: 'count',
            filter: [
              {
                field: 'eventType',
                op: 'eq',
                value: 'authentication.sso_failed',
              },
            ],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

WorkOS list endpoints return X-RateLimit-Remaining and X-RateLimit-Reset (Unix seconds) headers when throttling kicks in; the shared HTTP client falls back to Retry-After on 429.

## Limitations

- Authentication events use the WorkOS Events API filtered to authentication._ event types (sign-in success and failure across SSO, OAuth, password, magic auth, MFA). Other event categories (dsync._, organization.\*) are not synced.
- Organizations, connections, and directories are fetched in full on every sync; the WorkOS list endpoints do not expose a server-side updated_at filter, so the scope is cleared and rewritten on full syncs and left untouched on incremental syncs.
- Directory-sync user and group rows are out of scope; this connector tracks the directory entities themselves, not their imported memberships.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [WorkOS API docs](https://workos.com/docs/reference)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
