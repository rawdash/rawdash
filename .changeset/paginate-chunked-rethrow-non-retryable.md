---
'@rawdash/core': minor
---

`paginateChunked` now re-throws non-retryable HTTP errors (`AuthError`, `ClientBugError`) instead of collapsing them into a resumable `transientError` pinned to the current cursor. Previously any error from `fetchPage`/`writeBatch` was returned as a `transientError` at the same page, so a 401 (token revoked), 403, 404, or 422 told the consumer to "resume here" and the identical request was retried forever until the chunk cap, masking the real cause. Genuinely retryable errors (`TransientError`, `UpstreamBugError`, `RateLimitError`) and clean aborts still return a resumable boundary as before. Callers that drive `paginateChunked` should be prepared for a thrown typed error on permanently-failing syncs.
