---
'@rawdash/connector-sentry': patch
---

Fix `sentry_errors_per_hour` writing no samples when `stats_v2` response omits the top-level `intervals` field. Timestamps are now reconstructed from `start` + series length (1h buckets) when `intervals` is absent or empty.
