<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-auth0

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-auth0)](https://www.npmjs.com/package/@rawdash/connector-auth0)
[![license](https://img.shields.io/npm/l/@rawdash/connector-auth0)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync users, login events, and daily active-user / signup metrics from an Auth0 tenant for identity, sign-up, and failed-login dashboards.

## Install

```sh
npm install @rawdash/connector-auth0
```

## Authentication

OAuth 2.0 client-credentials flow against a Machine-to-Machine application authorized for the Auth0 Management API.

1. In the Auth0 Dashboard, open Applications -> Applications and create a new Machine to Machine Application.
2. Authorize the M2M app for the Auth0 Management API (Applications -> APIs -> Auth0 Management API -> Machine to Machine Applications).
3. Grant the M2M app the read:users, read:logs, and read:stats scopes (only the ones for the resources you intend to sync are required).
4. Copy the Domain (e.g. "acme.us.auth0.com"), Client ID, and Client Secret from the M2M application Settings tab.
5. Store the client secret as a rawdash secret and reference it from the connector config as `clientSecret: secret("AUTH0_CLIENT_SECRET")`.

## Configuration

| Field               | Type   | Required | Description                                                                                                                                                                          |
| ------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain`            | string | Yes      | Auth0 tenant domain (e.g. "acme.us.auth0.com" or a custom domain ending in .auth0.com). Used as the API host and as the audience when minting M2M tokens.                            |
| `clientId`          | string | Yes      | Client ID of the Auth0 Machine-to-Machine application authorized to call the Management API.                                                                                         |
| `clientSecret`      | secret | Yes      | Client secret of the Auth0 Machine-to-Machine application. Stored as a secret.                                                                                                       |
| `resources`         | array  | No       | Which Auth0 resources to sync. Omit to sync all of them. The M2M application only needs the Management API scopes for the resources listed here (read:users, read:logs, read:stats). |
| `statsLookbackDays` | number | No       | How many days of daily-active-user / signup stats to refresh on each sync. Defaults to 30 (the maximum the Auth0 Daily Stats endpoint returns).                                      |

## Resources

- **`auth0_user`** _(entity)_ - Auth0 users keyed by user_id, with email, primary identity provider, last login, login count, and blocked flag.
  - Endpoint: `GET /api/v2/users`
  - Uses offset pagination (page / per_page) and is capped at the first 1000 users per sync. Incremental syncs filter on updated_at via the q parameter.
  - `email`: Primary email address.
  - `identityProvider`: Provider of the primary identity (e.g. auth0, google-oauth2, samlp).
  - `lastLogin`: Most recent login timestamp (Unix ms).
  - `loginsCount`: Total successful logins (counter maintained by Auth0).
  - `blocked`: Whether the user has been administratively blocked.
  - `createdAt`: When the user record was created (Unix ms).
- **`auth0_login_event`** _(event)_ - Login / authentication events from the Auth0 Logs endpoint. One event per log row of type s (success), f (failure), seacft (token exchange success), or fp (failed change password).
  - Endpoint: `GET /api/v2/logs`
  - Uses offset pagination (page / per_page) and is capped at the first 1000 events per sync. Incremental syncs filter on date via the q parameter.
  - `logId`: Auth0 log row id.
  - `type`: Auth0 log type (s, f, seacft, fp).
  - `userId`: Auth0 user_id the event belongs to (may be null).
  - `ip`: Source IP of the login attempt.
  - `connection`: Connection name used for the login.
  - `strategy`: Identity provider strategy (e.g. auth0, google-oauth2, samlp).
- **`auth0_daily_active_users`** _(metric)_ - Daily logins and signups, one sample per day for the configured lookback window (up to 30 days, the Daily Stats endpoint maximum).
  - Endpoint: `GET /api/v2/stats/daily`
  - Unit: count
  - Granularity: 1d
  - Dimensions: `kind`

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const auth0 = {
  name: 'auth0',
  connectorId: 'auth0',
  config: {
    domain: 'acme.us.auth0.com',
    clientId: 'AbCdEf...',
    clientSecret: secret('AUTH0_CLIENT_SECRET'),
  },
};

export default defineConfig({
  connectors: [auth0],
  dashboards: {
    identity: defineDashboard({
      widgets: {
        active_users: {
          kind: 'stat',
          title: 'Auth0 users',
          metric: defineMetric({
            connector: auth0,
            shape: 'entity',
            entityType: 'auth0_user',
            fn: 'count',
            filter: [{ field: 'blocked', op: 'eq', value: false }],
          }),
        },
        failed_logins: {
          kind: 'stat',
          title: 'Failed logins',
          metric: defineMetric({
            connector: auth0,
            shape: 'event',
            name: 'auth0_login_event',
            fn: 'count',
            filter: [{ field: 'type', op: 'eq', value: 'f' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Auth0 publishes X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset response headers on Management API calls; the shared HTTP client backs off on 429 with the standard rate-limit policy.

## Limitations

- User enumeration uses offset pagination (page/per_page) and is capped at the first 1000 users per sync; tenants with more than 1000 users updated since the last run should increase sync frequency so each window stays under the cap.
- Action / hook / branding configuration objects are out of scope.
- Only Auth0 tenants on the _.auth0.com hostname suffix are supported; custom-domain tenants must still expose a _.auth0.com hostname for the Management API.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Auth0 API docs](https://auth0.com/docs/api/management/v2)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
