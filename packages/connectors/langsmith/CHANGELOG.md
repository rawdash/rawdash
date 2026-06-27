# @rawdash/connector-langsmith

## 0.28.1

### Patch Changes

- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Minor Changes

- 0e4102e: Standardize the `langsmith_runs_per_day` and `langsmith_feedback` metric output to the canonical metric-shape contract. The `langsmith_runs_per_day` run count now lives only in the `MetricSample` `value` field and is no longer mirrored into the `count` attribute; widgets that want the run count use `field: 'value'`. `totalTokens`, `promptTokens`, `completionTokens`, `costUsd`, and `latencyMs` are declared as `measures`; `sessionId`, `sessionName`, `runType`, and `status` remain `dimensions`. For `langsmith_feedback`, the redundant `score` attribute (a mirror of `value`) is removed, `count` and `hasNumericScore` are declared as `measures`, and `key`, `sessionId`, and `runId` remain `dimensions`.

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

- 5f33f22: Add `@rawdash/connector-langsmith` covering LangSmith runs (entity), per-run
  samples surfaced as `langsmith_runs_per_day` (token / cost / latency attributes
  so widgets aggregate by day or project at query time), and feedback scores.
  Auth via `x-api-key`; endpoint defaults to US cloud and is configurable to EU
  or self-hosted origins.
- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0
