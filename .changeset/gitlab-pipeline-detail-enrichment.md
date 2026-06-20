---
'@rawdash/connector-gitlab': patch
---

Fix GitLab pipeline `duration_ms` and `finished_at` always being null. The pipelines list endpoint does not return `duration`, `started_at`, or `finished_at`; each pipeline is now enriched via the single-pipeline endpoint so pipeline entities and `pipeline_event` events carry the real duration and finish time.
