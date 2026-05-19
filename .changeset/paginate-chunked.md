---
'@rawdash/core': minor
'@rawdash/connector-github': minor
---

Add `paginateChunked` helper to `@rawdash/core` for resumable phased pagination, and adopt it in `@rawdash/connector-github`. Connectors that hit the Cloudflare Worker subrequest cap mid-sync can now opt-in by declaring an ordered list of phases plus per-page `fetchPage` / `writeBatch` callbacks; the helper handles cursor advancement, abort handling, and phase rollover, so each sync chunk picks up where the previous one left off.
