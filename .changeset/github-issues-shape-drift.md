---
'@rawdash/connector-github': patch
---

Relax `issues` Zod schema to tolerate additional GitHub API fields surfaced by shape-drift detection (RAW-339).

All newly observed fields on `$[*]` and `$[*].user` are accepted as optional, and `user` allows unknown keys via `catchall`. `closed_at` is intentionally left as `iso.datetime().nullable()` even though the latest sample showed only `string` — the existing nullable shape reflects API reality for open issues. No behavioral changes to sync or aggregate paths.
