---
'@rawdash/core': patch
---

Add `computeRetryBackoffMs(consecutiveErrors, opts)` and `normalizeRetryAfter(retryAfter, now, maxSeconds)` retry-policy helpers. `computeRetryBackoffMs` derives an exponential-with-ceiling backoff from a consecutive-error count, with the base and ceiling supplied by the caller. `normalizeRetryAfter` clamps a connector's `RateLimitError.retryAfter` hint into a bounded, whole-second delay. Both are pure functions for integrators driving OSS connectors.
