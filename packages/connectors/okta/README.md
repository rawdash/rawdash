<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-okta

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-okta)](https://www.npmjs.com/package/@rawdash/connector-okta)
[![license](https://img.shields.io/npm/l/@rawdash/connector-okta)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync users, groups, and authentication events from an Okta org for sign-in volume, sign-in failure rate, and MFA enrollment analytics.

## Install

```sh
npm install @rawdash/connector-okta
```

## Authentication

An Okta API token (SSWS) is required. Tokens inherit the permissions of the admin who created them, so use a read-only admin account for least privilege. Tokens never leave the org.

1. Sign in to your Okta admin console as a user with read access to Users, Groups, and the System Log.
2. Open Security -> API -> Tokens and click Create Token.
3. Name the token (e.g. "rawdash"), copy the generated value (Okta only shows it once), and finish.
4. Store the token as a secret and reference it from config as `apiToken: secret("OKTA_API_TOKEN")`, alongside the org host (the "acme.okta.com" part of your admin URL).

## Configuration

| Field       | Type   | Required | Description                                                                                                                          |
| ----------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `host`      | string | Yes      | Your Okta org hostname, e.g. "acme.okta.com" or "acme.oktapreview.com". Do not include the protocol or trailing slash.               |
| `apiToken`  | secret | Yes      | Okta API token (SSWS). Create one at Security -> API -> Tokens. Read-only access to Users, Groups, and the System Log is sufficient. |
| `resources` | array  | No       | Which Okta resources to sync. Omit to sync all of them. The API token only needs read scopes for the resources listed here.          |

## Resources

- **`okta_user`** _(entity)_ - Okta users with lifecycle status, last-login timestamp, and profile email / login.
  - Endpoint: `GET /api/v1/users`
  - `status`: Lifecycle status (ACTIVE, SUSPENDED, etc).
  - `email`: Primary email address from profile.email.
  - `login`: Login identifier (usually the primary email).
  - `firstName`: First name from profile.firstName.
  - `lastName`: Last name from profile.lastName.
  - `lastLogin`: Last successful sign-in time (Unix ms, null if never).
  - `createdAt`: When the user was created (Unix ms).
  - `activatedAt`: When the user account was activated (Unix ms).
- **`okta_group`** _(entity)_ - Okta groups (native, app-managed, and built-in) with their name, description, and type.
  - Endpoint: `GET /api/v1/groups`
  - `name`: Group display name.
  - `description`: Group description.
  - `type`: Group type (OKTA_GROUP for native, APP_GROUP for app-managed, BUILT_IN for system).
  - `createdAt`: When the group was created (Unix ms).
  - `lastMembershipUpdatedAt`: Last time membership changed (Unix ms).
- **`okta_auth_event`** _(event)_ - Authentication events from the Okta System Log (sign-in starts, MFA challenges, SSO sign-ins, admin-app access).
  - Endpoint: `GET /api/v1/logs`
  - The scope is cleared and rewritten on every full sync; incremental syncs append events whose `published` is strictly newer than `options.since`.
  - `eventType`: Okta event type, e.g. user.session.start.
  - `result`: Outcome result (SUCCESS / FAILURE / ALLOW / DENY / CHALLENGE).
  - `reason`: Outcome reason string (vendor wording, free-form).
  - `actorId`: Acting subject id (usually the user id, null if anonymous).
  - `actorType`: Acting subject type, e.g. "User".
  - `authenticationProvider`: Provider that performed the authentication.
  - `credentialType`: Credential type used (PASSWORD, OTP, EMAIL, etc).
  - `ipAddress`: Client IP address recorded by Okta.
  - `country`: Geographical country derived by Okta from the client IP.
  - `severity`: Severity assigned by Okta (DEBUG, INFO, WARN, ERROR).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const okta = {
  name: 'okta',
  connectorId: 'okta',
  config: {
    host: 'acme.okta.com',
    apiToken: secret('OKTA_API_TOKEN'),
  },
};

export default defineConfig({
  connectors: [okta],
  dashboards: {
    identity: defineDashboard({
      widgets: {
        active_users: {
          kind: 'stat',
          title: 'Active users',
          metric: defineMetric({
            connector: okta,
            shape: 'entity',
            entityType: 'okta_user',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'ACTIVE' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Okta publishes per-endpoint quotas (commonly 600 to 1200 requests/minute on production orgs, lower for trial orgs) and exposes X-Rate-Limit-Remaining and X-Rate-Limit-Reset (Unix seconds) on every response. The shared HTTP client honors those headers when scheduling the next request and falls back to Retry-After on 429.

## Limitations

- Daily-active-users is not synced as a metric; derive it at query time over the okta_auth_event scope (filter eventType to a sign-in success and count distinct actor ids per day).
- Application assignments, factors, devices, and the policy / authorization-server APIs are out of scope.
- Only successful and failed sign-in System Log events are captured; broader event types (admin actions, lifecycle changes) can be added later.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Okta API docs](https://developer.okta.com/docs/reference/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
