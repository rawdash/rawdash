# @rawdash/connector-bitbucket

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

### Minor Changes

- c0ee2bf: Migrate Bitbucket authentication to Atlassian API tokens and fix the pull request `state` filter.

  Breaking config change: the `appPassword` credential is renamed to `apiToken` and the `username` config field is renamed to `email`. Authentication now uses HTTP Basic auth with the Atlassian account email as the username and an Atlassian API token as the password. Update your config to set `email` and `apiToken` (create a token at https://id.atlassian.com/manage-profile/security/api-tokens).

  The pull request query now sends repeated `state` parameters (`state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED`) as required by the Bitbucket Cloud REST API, instead of a single comma-joined value that matched no enum member.

### Patch Changes

- @rawdash/core@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0

## 0.22.0

### Patch Changes

- 833af29: Deduplicate Bitbucket pipeline writes by uuid within a sync so a pipeline that repeats across pages (or within a single page) yields exactly one `pipeline` entity and one `pipeline_event`, instead of double-counting events. Entities already deduped via last-write-wins on their id, but `pipeline_event` rows were appended once per occurrence.
- beb78ff: Require a `domain` field on connector vendor metadata, and give each connector a vendor domain.

  `connectorDocSchema` now requires `vendor.domain` (a validated hostname), so every connector declares the vendor's domain. This is a breaking change for connector authors using `@rawdash/core` directly. All built-in connectors now set `vendor.domain`.

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0

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
