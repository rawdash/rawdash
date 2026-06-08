# @rawdash/connector-bitbucket

## 0.21.1

### Patch Changes

- @rawdash/core@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Minor Changes

- b7fbbdc: Add `@rawdash/connector-bitbucket` — sync Bitbucket Cloud pull requests, pipelines, and pipeline lifecycle events. Authenticates via an Atlassian username + Bitbucket app password (Basic auth). Configure one or more repository slugs per workspace; pagination is body-based via the `next` URL and incremental syncs filter on `updated_on`/`created_on` via the BBQL `q=` parameter.

### Patch Changes

- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0
