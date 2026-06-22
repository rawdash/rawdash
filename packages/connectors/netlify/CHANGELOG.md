# @rawdash/connector-netlify

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

- 32d0d2c: Fix the deploys sync emitting duplicate `netlify_deploy_event` rows for a single unique deploy id. Deploy entities collapse to one row per `(site, deploy id)` via last-write-wins, but events were appended unconditionally inside the loop, so a page containing duplicate deploy ids produced multiple events. Events are now deduped by `(site, deploy id)` (last occurrence wins) to match entity semantics.
- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Minor Changes

- 20c6db4: Add `@rawdash/connector-netlify` - syncs Netlify sites and deploys into the six-shape storage model: `netlify_site` and `netlify_deploy` as entities, plus `netlify_deploy_event` per deploy spanning created->published. Authenticates with a Netlify personal access token (Bearer). The deploys phase iterates each site (configured via `siteIds` or discovered from `GET /sites`), paginating per-site via the standard Link header. Netlify has no server-side date filter on the deploys endpoint, so `deploysLookbackDays` (when set) is applied client-side and short-circuits pagination once a full page is older than the cutoff.

### Patch Changes

- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0
