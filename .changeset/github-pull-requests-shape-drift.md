---
'@rawdash/connector-github': patch
---

Extend `pull_requests` Zod schema with newly observed GitHub API fields (forward-compat shape drift). All new fields are optional to remain tolerant of partial payloads.
