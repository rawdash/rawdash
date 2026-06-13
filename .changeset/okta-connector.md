---
'@rawdash/connector-okta': minor
'@rawdash/connectors': minor
---

Add `@rawdash/connector-okta`. Syncs users, groups, and authentication events from an Okta org via the Management API (`/api/v1/users`, `/api/v1/groups`) and System Log (`/api/v1/logs`). SSWS API-token auth, configurable org host, Link-header pagination, incremental SCIM `lastUpdated gt` filtering on entity resources, and native `since` on the System Log; honors Okta's `X-Rate-Limit-*` headers via the shared rate-limit policy.
