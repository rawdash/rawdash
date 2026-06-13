---
'@rawdash/connector-github': patch
---

Fix mis-windowing in GitHub connector: `specCutoff` now respects the `since` backfill buffer when `fetchSpecs` are present, ensuring `open_prs` and `workflow_runs` are not dropped near the window boundary.
