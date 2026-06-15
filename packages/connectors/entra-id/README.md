<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-entra-id

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-entra-id)](https://www.npmjs.com/package/@rawdash/connector-entra-id)
[![license](https://img.shields.io/npm/l/@rawdash/connector-entra-id)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync users, sign-in events, and risky users from a Microsoft Entra ID (formerly Azure AD) tenant for sign-in volume, failed-sign-in rate, and identity-risk dashboards.

## Install

```sh
npm install @rawdash/connector-entra-id
```

## Authentication

OAuth 2.0 client-credentials flow against the Microsoft identity platform, using an Entra app registration with Microsoft Graph application permissions.

1. In the Azure portal, open Microsoft Entra ID -> App registrations and create a new registration (single tenant).
2. Under API permissions, add Microsoft Graph Application permissions for the resources you want to sync: User.Read.All (users), AuditLog.Read.All (signins), IdentityRiskyUser.Read.All (risky_users). Grant admin consent.
3. Under Certificates & secrets, add a new client secret and copy the Value (not the Secret ID) immediately - Azure only shows it once.
4. Copy the Directory (tenant) ID and Application (client) ID from the registration overview.
5. Store the client secret as a rawdash secret and reference it from the connector config as `clientSecret: secret("ENTRA_CLIENT_SECRET")`.

## Configuration

| Field                 | Type   | Required | Description                                                                                                                                                                                                                           |
| --------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenantId`            | string | Yes      | Microsoft Entra tenant identifier. Either the directory (tenant) GUID from the Azure portal, or a verified domain such as "contoso.onmicrosoft.com".                                                                                  |
| `clientId`            | string | Yes      | Application (client) ID of the Entra app registration used to call Microsoft Graph.                                                                                                                                                   |
| `clientSecret`        | secret | Yes      | Client secret value (not the secret ID) from the app registration. Stored as a secret.                                                                                                                                                |
| `resources`           | array  | No       | Which Entra ID resources to sync. Omit to sync all of them. The app registration only needs the Microsoft Graph application permissions for the resources listed here (User.Read.All, AuditLog.Read.All, IdentityRiskyUser.Read.All). |
| `signinsLookbackDays` | number | No       | How many days of sign-in events to backfill on a full sync. Defaults to 7. Microsoft Graph retains sign-in logs for 30 days on the Premium tiers required to call the API.                                                            |

## Resources

- **`entra_user`** _(entity)_ - Entra ID users with display name, principal name, mail, account-enabled flag, and user type.
  - Endpoint: `GET /v1.0/users`
  - Fully enumerated on every sync; @odata.nextLink pages are followed within the chunked sync loop.
  - `displayName`: Display name from the directory.
  - `userPrincipalName`: User principal name (e.g. alice@contoso.com).
  - `mail`: Primary SMTP address (may be null).
  - `accountEnabled`: Whether the account is enabled (sign-in allowed when true).
  - `userType`: Either "Member" (in-tenant) or "Guest" (B2B invitee).
  - `createdAt`: When the user was created (Unix ms).
- **`entra_signin_event`** _(event)_ - Sign-in events from the Entra ID audit logs (`/auditLogs/signIns`). One event per interactive sign-in attempt with user, app, IP, location, and risk fields.
  - Endpoint: `GET /v1.0/auditLogs/signIns`
  - Backfill window defaults to 7 days and is capped at the Microsoft Graph 30-day retention. Incremental syncs filter on `createdDateTime`.
  - `status`: Aggregated status: "success" when the sign-in completed without error, otherwise "failure".
  - `errorCode`: Microsoft Graph signInStatus.errorCode (0 on success).
  - `failureReason`: Human-readable failure reason (null on success).
  - `userId`: Directory object id of the actor.
  - `userPrincipalName`: User principal name at sign-in time.
  - `appId`: Application (client) id signed into.
  - `appDisplayName`: Display name of the application signed into.
  - `ipAddress`: Client IP recorded by Entra.
  - `countryOrRegion`: Geographic country/region from location.countryOrRegion.
  - `city`: City from location.city (may be null).
  - `riskLevel`: Aggregated risk level (none / low / medium / high / hidden / unknownFutureValue).
  - `riskState`: Risk state (none / confirmedSafe / remediated / dismissed / atRisk / confirmedCompromised).
  - `clientAppUsed`: Client app type (Browser, Mobile Apps and Desktop clients, etc.).
  - `conditionalAccessStatus`: Outcome of conditional-access policy evaluation (success / failure / notApplied / unknownFutureValue).
- **`entra_risky_user`** _(entity)_ - Users currently flagged by Entra Identity Protection, with their risk level, risk state, and last-updated timestamp.
  - Endpoint: `GET /v1.0/identityProtection/riskyUsers`
  - Fully enumerated on every sync; @odata.nextLink pages are followed within the chunked sync loop.
  - `userPrincipalName`: User principal name of the risky user.
  - `displayName`: Display name of the risky user.
  - `riskLevel`: Identity Protection risk level (low / medium / high / hidden / unknownFutureValue).
  - `riskState`: Risk state (none / confirmedSafe / remediated / dismissed / atRisk / confirmedCompromised / unknownFutureValue).
  - `riskDetail`: Latest risk detail string (the specific reason for the flag).
  - `riskLastUpdatedAt`: When the risk was last refreshed (Unix ms).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const entraId = {
  name: 'entra-id',
  connectorId: 'entra-id',
  config: {
    tenantId: '00000000-0000-0000-0000-000000000000',
    clientId: '11111111-1111-1111-1111-111111111111',
    clientSecret: secret('ENTRA_CLIENT_SECRET'),
  },
};

export default defineConfig({
  connectors: [entraId],
  dashboards: {
    identity: defineDashboard({
      widgets: {
        active_users: {
          kind: 'stat',
          title: 'Enabled users',
          metric: defineMetric({
            connector: entraId,
            shape: 'entity',
            entityType: 'entra_user',
            fn: 'count',
            filter: [{ field: 'accountEnabled', op: 'eq', value: true }],
          }),
        },
        failed_signins: {
          kind: 'stat',
          title: 'Failed sign-ins',
          metric: defineMetric({
            connector: entraId,
            shape: 'event',
            name: 'entra_signin_event',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'failure' }],
          }),
        },
        risky_users: {
          kind: 'stat',
          title: 'Risky users',
          metric: defineMetric({
            connector: entraId,
            shape: 'entity',
            entityType: 'entra_risky_user',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Microsoft Graph applies per-app and per-tenant throttling. The shared HTTP client backs off on 429 using Retry-After and the standard rate-limit policy.

## Limitations

- The sign-in logs and risky-users endpoints require Entra ID P1 or P2; tenants on the free tier cannot call them and the connector will surface a 4xx from Microsoft Graph.
- Sign-in logs are retained by Microsoft for 30 days; backfills beyond that window return no data.
- Conditional Access, application assignments, and audit logs (admin activity) are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Microsoft Entra ID API docs](https://learn.microsoft.com/en-us/graph/api/resources/signin)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
