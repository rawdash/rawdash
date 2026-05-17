---
'@rawdash/core': patch
---

Fix `resolvedMetricSchema`: make `field` optional (count-only metrics like `{ fn: 'count' }` have no field) and narrow `fn` from `z.string()` to `aggFnSchema` so consumers get the proper enum type and invalid fns are rejected at validation time.
