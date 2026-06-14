---
'@rawdash/connector-datadog': patch
---

Datadog connector: fix the `datadog_slo_sli` metric, monitor status enum, and timeseries null handling.

- `datadog_slo_sli` now reads SLI values from the SLO history endpoint (`GET /api/v1/slo/{slo_id}/history`) per SLO, using `data.overall.sli_value` timestamped at the response `to_ts` (seconds → ms) over a window derived from the SLO threshold timeframes. Previously it read `overall_status` / `sli_value` fields that the SLO list endpoint never returns, so it silently produced zero samples. `datadog_slo.latestSliValue` is now populated from the same source.
- Added `Skipped` and `Unknown` to the monitor `status` enum (schema, type, and filterable values) so monitors in those states no longer fail the whole monitors batch.
- Timeseries values are now nullable and `null` gap points are skipped instead of failing the metrics parse.
