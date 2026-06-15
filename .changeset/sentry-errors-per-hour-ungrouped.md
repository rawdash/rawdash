---
'@rawdash/connector-sentry': minor
---

Fix `sentry_errors_per_hour` emitting zero samples. The `stats_v2` query combined `groupBy=project` with `interval=1h`, for which Sentry returns per-group totals only — no per-group time series and no top-level `intervals` — so the transform had nothing to emit. The query now drops `groupBy=project` and the connector emits the org-wide hourly series (summing across any groups Sentry still returns), with explicit zeros for empty hours so a genuine 0 reads as `0` rather than `no_data`. The per-project `project` dimension is removed from the metric.
