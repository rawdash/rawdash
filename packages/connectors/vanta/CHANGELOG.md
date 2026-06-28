# @rawdash/connector-vanta

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

- ebacf62: Add `@rawdash/connector-vanta`. Syncs controls, tests, and test findings from a Vanta workspace via the Public API (`/v1/controls`, `/v1/tests`, `/v1/test-findings`) for compliance dashboards (audit-ready %, failing-test counts, open finding counts and severity breakdowns). OAuth 2.0 client-credentials auth (default `vanta-api.all:read` scope), cursor pagination, configurable findings lookback window, and full + incremental sync modes.
  - @rawdash/core@0.27.0
