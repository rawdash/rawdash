---
'@rawdash/connector-azure-monitor': patch
---

Correct the Azure Monitor REST API versions and clamp the metrics window to retention. The metrics api-version was `2024-02-01`, the data-plane Metrics Batch (`metrics:getBatch`) GA version, sent to the control-plane `providers/Microsoft.Insights/metrics` endpoint where it relied on undocumented acceptance; it is now `2023-10-01`, the documented current control-plane Metrics - List version. The alerts api-version moved from the deprecated preview `2019-05-05-preview` to GA `2019-03-01` (the `essentials` fields the connector reads are part of the long-stable Essentials object, so parsing is unchanged). `computeMetricsTimespan` now clamps the timespan start to Azure Monitor's ~92-day metric retention floor and logs a truncation warning when a far-back `since` backfill is cut, instead of silently requesting buckets Azure never returns; the lookback path (bounded at 28 days) and `latest` path are unaffected.
