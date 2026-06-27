# @rawdash/connector-okta

## 0.28.1

### Patch Changes

- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0

## 0.27.0

### Patch Changes

- @rawdash/core@0.27.0

## 0.26.0

### Patch Changes

- @rawdash/core@0.26.0

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
