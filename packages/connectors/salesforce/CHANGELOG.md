# @rawdash/connector-salesforce

## 0.28.0

### Patch Changes

- 6ca0ebf: Use `SystemModstamp` instead of `LastModifiedDate` as the incremental cursor for the `accounts`, `leads`, and `opportunities` resources. `LastModifiedDate` only advances on user-initiated changes, so records modified by automated Salesforce processes (Flows, Process Builder, roll-up summary recalculation, lead-conversion side effects) were silently dropped from incremental syncs and left stale. `SystemModstamp` advances on both user and system changes, is always `>= LastModifiedDate`, and is indexed (avoiding non-selective query timeouts on large objects). The three resources now select, filter, and order by `SystemModstamp`, and derive their `updated_at` high-water mark from it. The `opportunity_events` resource continues to use `CreatedDate`, which is correct for immutable field-history rows.
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

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Patch Changes

- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0

## 0.17.0

### Minor Changes

- 189a912: Add `@rawdash/connector-salesforce` — syncs Salesforce opportunities, accounts, leads, users, and opportunity stage-change events into the six-shape storage model. Authenticates with OAuth 2.0 refresh token against a Connected App. Fetches each standard object via SOQL (`/services/data/v59.0/query`) with `LastModifiedDate >= <since>` incremental filtering, paginates via `nextRecordsUrl`, and reads stage transitions from `OpportunityFieldHistory`. v1 covers standard objects only; custom objects and Marketing Cloud are tracked separately.

### Patch Changes

- @rawdash/core@0.17.0
