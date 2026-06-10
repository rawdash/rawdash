---
'@rawdash/connector-sentry': patch
---

Update the Sentry `error_stats` schema to tolerate the `stats_v2` response shape: `intervals` is now `.optional()`. Other observed drift (`groups[*].by.project`, `groups[*].totals["sum(quantity)"]`, `series`, `start`/`end`) is already permitted by the existing schema and needed no change.
