---
'@rawdash/core': minor
---

Make `computeRetention` spec-driven and watermark-aware with entity coverage.

- Replace `RetentionConfig { maxAge }` input with a new `RetentionSpec` type that accepts per-resource `FetchSpec[]` and rollup watermarks
- A raw row is deleted only when it falls outside every live FetchSpec keep-set AND its timestamp is before the rollup watermark (already folded into buckets)
- Extend `RetentionDeletionPlan` and `computeRetention` to include entities
- Entity rows are kept if they match any live spec filter (no-window specs keep matching entities indefinitely); a configurable `gracePeriodMs` protects recently-updated entities from immediate deletion after they leave all keep-sets
- Add `RetentionSpec` to the public core exports
- `selectForDeletion` and `RetentionConfig` are preserved for backward compatibility with the server retention path
