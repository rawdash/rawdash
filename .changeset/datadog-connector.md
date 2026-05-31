---
'@rawdash/connector-datadog': minor
---

Add `@rawdash/connector-datadog` — syncs Datadog monitors and monitor state transitions, incidents, SLOs (entity + per-snapshot SLI metric), and user-declared metric timeseries queries. Authenticates with a Datadog API key + Application key against a configurable site (`datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`, …). Supports `resources` filtering, chunked resumable pagination across all phases, and incremental `since` filtering on incidents and metric queries.
