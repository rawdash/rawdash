---
'@rawdash/core': patch
---

`defineMetric` now defaults `field` to `'value'` for metric-shape resources when omitted, matching the implicit `value` column metric records store. This fixes ~16 connector `example.config.ts` files (and any metric-shape widget using `fn: 'sum'`/`avg`/etc. without an explicit `field`) that failed to load with `field is required unless fn is "count"`.
