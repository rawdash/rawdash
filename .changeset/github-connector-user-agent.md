---
'@rawdash/connector-github': patch
---

Send a `User-Agent` header on all GitHub API requests. GitHub rejects requests without a UA with `403 Forbidden`; this worked locally because Node's `fetch` supplies a default UA, but failed in Cloudflare Workers where `fetch` does not.
