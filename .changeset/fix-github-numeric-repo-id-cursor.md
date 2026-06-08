---
'@rawdash/connector-github': patch
---

Fix cursor resume resetting to page 1 when GitHub's pagination Link header uses the numeric repo ID URL form (`/repositories/:id/...`) instead of the canonical owner/repo form. `sanitizePageUrl` now accepts both forms, so a chunk that hits the `maxChunkMs` budget correctly resumes from the next page on the following alarm invocation.
