# @rawdash/connector-workos

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

- 7cb0b72: Add `@rawdash/connector-workos`. Syncs WorkOS organizations, SSO connections, directory-sync directories, and authentication events (SSO/OAuth/password/magic-auth/MFA succeeded and failed) into the six-shape storage model. Bearer-token auth via a WorkOS API key, cursor pagination via `list_metadata.after`, and `range_start` push-down for the Events API so incremental syncs only fetch events newer than the watermark.
  - @rawdash/core@0.27.0
