# @rawdash/connector-datadog

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0

## 0.17.0

### Minor Changes

- c89abb8: Add `@rawdash/connector-datadog` — syncs Datadog monitors and monitor state transitions, incidents, SLOs (entity + per-snapshot SLI metric), and user-declared metric timeseries queries. Authenticates with a Datadog API key + Application key against a configurable site (`datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`, …). Supports `resources` filtering, chunked resumable pagination across all phases, and incremental `since` filtering on incidents and metric queries.

### Patch Changes

- @rawdash/core@0.17.0
