---
'@rawdash/sdk-runtime': patch
'@rawdash/sdk-nextjs': patch
---

Add an `onBootstrapped` callback to `subscribe` and a `loading` flag to `useDashboard`/`useWidget`, fired/cleared once the first bootstrap fetch settles. This lets dashboards show a spinner during the initial load instead of flashing an empty-state placeholder before the first fetch resolves.
