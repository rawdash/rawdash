# @rawdash/connector-okta

## 0.29.1

### Patch Changes

- 1493771: Fix two Okta data-correctness bugs. The System Log (`GET /api/v1/logs`) full/initial sync omitted the `since` parameter, so Okta applied its default window of the last 7 days; because a full sync clears the `okta_auth_event` scope before repopulating it, every full sync truncated sign-in history to 7 days even though Okta retains 90 days. Full/initial syncs now default `since` to the start of the 90-day retention window, so they backfill the full available history; incremental syncs continue to use their own `since`. Separately, the users listing (`GET /api/v1/users`) used the `filter` query parameter, which never returns `DEPROVISIONED` users — deactivated/offboarded accounts were silently dropped from the `okta_user` resource. The listing now uses the `search` parameter (for both the `lastUpdated` incremental cursor and the pushed-down `status` predicate), which returns every lifecycle status including `DEPROVISIONED`; group syncs are unaffected and keep using `filter`.
- Updated dependencies [d83f3eb]
  - @rawdash/core@0.29.1

## 0.29.0

### Patch Changes

- Updated dependencies [48283df]
- Updated dependencies [8eb995a]
  - @rawdash/core@0.29.0

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2

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
