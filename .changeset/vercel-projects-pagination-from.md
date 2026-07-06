---
'@rawdash/connector-vercel': patch
---

Fix projects pagination so it advances past the first page. The projects list endpoint continues via the `from` continuation token, not `until` — the connector was sending `pagination.next` back as `until`, which that endpoint does not accept, so any account with more than 100 projects re-read the first page indefinitely and never synced projects 101+. Projects now paginate via `from` (handled as a string-or-number continuation token) and target the current `GET /v10/projects` endpoint; the deployments list still paginates via `until`, which is correct.
