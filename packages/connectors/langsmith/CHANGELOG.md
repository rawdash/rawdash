# @rawdash/connector-langsmith

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
