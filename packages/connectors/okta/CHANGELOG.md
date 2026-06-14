# @rawdash/connector-okta

## 0.25.0

### Patch Changes

- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0

## 0.24.0

### Patch Changes

- efc8fc0: Add `@rawdash/connector-okta`. Syncs users, groups, and authentication events from an Okta org via the Management API (`/api/v1/users`, `/api/v1/groups`) and System Log (`/api/v1/logs`). SSWS API-token auth, configurable org host, Link-header pagination, incremental SCIM `lastUpdated gt` filtering on entity resources, and native `since` on the System Log; honors Okta's `X-Rate-Limit-*` headers via the shared rate-limit policy.
- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0
