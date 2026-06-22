# @rawdash/connector-langfuse

## 0.28.0

### Minor Changes

- 0e4102e: Standardize the `langfuse_observations_per_day` and `langfuse_scores` metric output to the canonical metric-shape contract. The canonical numeric now lives only in the `MetricSample` `value` field and is no longer mirrored into `attributes`. For observations, `model` remains a `dimension` while `inputTokens`, `outputTokens`, `totalTokens`, and `costUsd` are declared as `measures` (the observation count is carried only in `value`, no longer also as `countObservations`). For scores, the score name is now the `scoreName` dimension (renamed from the reserved `name`) and `count` is a `measure`; the mean score is carried only in `value`, no longer also as `average`.

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

### Minor Changes

- a4b89c4: Add `@rawdash/connector-langfuse` - sync LLM traces (as entities), daily observation volume + token + cost rollups by model (as metrics), and daily score averages by name (as metrics) from a Langfuse project. Authenticates over HTTP Basic auth using a Langfuse public + secret API key pair scoped to one project; supports Langfuse Cloud (`https://cloud.langfuse.com` + the US / EU regional variants) and self-hosted instances via a configurable `host`.

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0
