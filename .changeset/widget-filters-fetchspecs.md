---
'@rawdash/core': minor
'@rawdash/connector-github': patch
'@rawdash/server': patch
---

Carry widget filters into connector fetch via per-resource FetchSpecs.

`@rawdash/core` now models backfill output as `ResourceBackfill { specs: FetchSpec[] }` (was `{ requiredWindowMs }`), merging per resource so same-filter specs collapse to the loosest window while different filter sets are kept apart. Adds `fetchSpecsForConnector`, `SyncOptions.fetchSpecs`, `resolveSpecCutoff`, optional `filterable` on resource definitions, and per-spec cursor support in `paginateChunked`. The GitHub connector pushes recognized `state` filters down to the API and applies a per-spec cutoff; the OSS sync runner routes through `fetchSpecsForConnector` so OSS and cloud share one fetch path.
