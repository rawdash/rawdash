---
'@rawdash/core': patch
'@rawdash/adapter-libsql': patch
---

Add incremental aggregation rollups (RAW-520). `@rawdash/core` now owns a bucket-based rollup mechanism so unbounded aggregates can be answered after raw rows are dropped: an incremental-merge primitive for the mergeable `AggFn`s (`count`/`sum`/`avg`/`min`/`max`/`latest`/`first`), `computeRollupSpecs` to derive the rollup dimension set and bucket granularity from widget configs, a `foldResourceRollups` fold step that folds only complete past buckets and advances a per-resource watermark, and a bucket-aware read path wired into `computeMetric` that merges materialized buckets with the raw tail since the watermark. New optional `StorageHandle` methods (`writeRollups`/`queryRollups`/`getRollupWatermark`/`setRollupWatermark`) are implemented in `InMemoryStorage` and the libsql adapter (new `rollups` + `rollup_watermarks` tables). The watermark lets retention safely drop raw `ts < watermark` outside live keep-sets.
