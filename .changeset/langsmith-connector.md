---
'@rawdash/connector-langsmith': patch
'@rawdash/connectors': patch
---

Add `@rawdash/connector-langsmith` covering LangSmith runs (entity), per-run
samples surfaced as `langsmith_runs_per_day` (token / cost / latency attributes
so widgets aggregate by day or project at query time), and feedback scores.
Auth via `x-api-key`; endpoint defaults to US cloud and is configurable to EU
or self-hosted origins.
