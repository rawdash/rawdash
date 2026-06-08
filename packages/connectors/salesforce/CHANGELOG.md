# @rawdash/connector-salesforce

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
