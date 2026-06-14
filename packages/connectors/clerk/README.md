<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-clerk

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-clerk)](https://www.npmjs.com/package/@rawdash/connector-clerk)
[![license](https://img.shields.io/npm/l/@rawdash/connector-clerk)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync users, organizations, sessions, and a derived daily-active-users metric from a Clerk application for sign-up, DAU, and active-session dashboards.

## Install

```sh
npm install @rawdash/connector-clerk
```

## Authentication

A Clerk Backend API secret key (Bearer token). Anyone with the key has read access to every resource the connector syncs.

1. Open the Clerk Dashboard for the application you want to sync and navigate to API Keys.
2. Copy the Secret key (it starts with `sk_test_` for development instances or `sk_live_` for production).
3. Store it as a rawdash secret and reference it from the connector config as `secretKey: secret("CLERK_SECRET_KEY")`.
4. Treat the secret key like a root credential - rotate it from the dashboard if it leaks.

## Configuration

| Field             | Type   | Required | Description                                                                                                                                                                             |
| ----------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secretKey`       | secret | Yes      | Clerk Backend API secret key (starts with `sk_test_` or `sk_live_`). Create one at Clerk Dashboard -> API Keys.                                                                         |
| `apiUrl`          | string | No       | Clerk Backend API base URL. Defaults to https://api.clerk.com; override only if you are pinned to the legacy https://api.clerk.dev host.                                                |
| `resources`       | array  | No       | Which Clerk resources to sync. Omit to sync all of them. The secret key has read access to every resource by default; the allowlist exists to skip phases your dashboards do not query. |
| `dauLookbackDays` | number | No       | How many days back to bucket users by last_active_at when computing the daily_active_users metric. Defaults to 30; the cap is 90.                                                       |

## Resources

- **`clerk_user`** _(entity)_ - Clerk users keyed by user id, with primary email, sign-in / activity timestamps, and banned / locked flags.
  - Endpoint: `GET /v1/users`
  - Uses offset pagination (limit / offset) capped at 50 pages (~25,000 users) per sync. Incremental syncs pass options.since through as the last_active_at_since filter.
  - `email`: Primary email address (when present).
  - `emailVerified`: Whether the primary email address is verified (null if no email is set).
  - `lastSignInAt`: Most recent sign-in timestamp (Unix ms).
  - `lastActiveAt`: Most recent activity timestamp (Unix ms). Clerk updates this on every successful client request.
  - `banned`: Whether the user has been banned.
  - `locked`: Whether the user is locked from signing in.
  - `createdAt`: When the user account was created (Unix ms).
- **`clerk_organization`** _(entity)_ - Clerk organizations keyed by organization id, with display name, slug, and members count.
  - Endpoint: `GET /v1/organizations`
  - Uses offset pagination (limit / offset) capped at 50 pages. Clerk has no created_at / updated_at filter for organizations, so each sync re-scans the full list and short-circuits once a page is entirely older than options.since.
  - `name`: Organization display name.
  - `slug`: Organization URL slug.
  - `membersCount`: Number of users in the organization at sync time.
  - `createdAt`: When the organization was created (Unix ms).
- **`clerk_session`** _(event)_ - Clerk session events. One event per session row with start_ts set to created_at and attributes carrying user id, status, and last activity.
  - Endpoint: `GET /v1/sessions`
  - Uses offset pagination (limit / offset) capped at 50 pages. Clerk has no since filter on /v1/sessions, so the sync walks newest-first and stops once a page is entirely older than options.since.
  - `sessionId`: Clerk session id.
  - `userId`: User the session belongs to.
  - `status`: Session status (active | ended | expired | abandoned | removed | replaced | revoked).
  - `lastActiveAt`: Most recent activity timestamp on the session (Unix ms).
- **`clerk_daily_active_users`** _(metric)_ - Daily active users derived from the Clerk users endpoint: one sample per UTC day in the configured lookback window, counting users whose last_active_at fell on that day.
  - Endpoint: `GET /v1/users`
  - Unit: count
  - Granularity: 1d

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const clerk = {
  name: 'clerk',
  connectorId: 'clerk',
  config: {
    secretKey: secret('CLERK_SECRET_KEY'),
  },
};

export default defineConfig({
  connectors: [clerk],
  dashboards: {
    identity: defineDashboard({
      widgets: {
        active_users: {
          kind: 'stat',
          title: 'Clerk users',
          metric: defineMetric({
            connector: clerk,
            shape: 'entity',
            entityType: 'clerk_user',
            fn: 'count',
            filter: [{ field: 'banned', op: 'eq', value: false }],
          }),
        },
        active_sessions: {
          kind: 'stat',
          title: 'Active sessions',
          metric: defineMetric({
            connector: clerk,
            shape: 'event',
            name: 'clerk_session',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'active' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Clerk Backend API throttles per instance (~20 req/s for production, lower for dev). Responses publish X-RateLimit-Remaining / X-RateLimit-Reset (Unix seconds) headers and the shared HTTP client backs off on 429 using the standard rate-limit policy.

## Limitations

- Each phase paginates via limit / offset and is capped at 50 pages per sync (~25,000 rows). Instances larger than that should run more frequent incremental syncs so each window fits under the cap.
- The daily_active_users metric is derived by bucketing users by the day of their last_active_at timestamp - it counts users whose most recent activity fell on each day, not unique users active across overlapping days.
- Webhooks, JWT templates, instance settings, and impersonation tokens are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Clerk API docs](https://clerk.com/docs/reference/backend-api)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
