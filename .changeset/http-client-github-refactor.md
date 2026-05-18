---
'@rawdash/connector-github': patch
---

Refactor GitHub connector onto the new internal `@rawdash/http-client` package: ad-hoc `fetch` call sites and retry logic are replaced by the shared client, which supplies a default `User-Agent`, typed errors (`AuthError` / `RateLimitError` / `TransientError` / `UpstreamBugError` / `ClientBugError`), retry with backoff and `Retry-After` handling, GitHub rate-limit header parsing, and Link-header pagination.
