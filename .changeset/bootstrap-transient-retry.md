---
'@rawdash/sdk-runtime': patch
---

Make dashboard bootstrap resilient to transient first-load failures. Previously a single failed `getWidgets()` on first load (cold start, brief 5xx, or a connection blip) immediately surfaced a hard error and then waited a flat 60s before its only retry — so the dashboard showed an error screen until a manual refresh. Bootstrap now retries on a short escalating backoff (`bootstrapRetryStartMs`, doubling up to `bootstrapRetryMaxMs`) and holds the loading state, only surfacing the error after `bootstrapErrorAfterAttempts` consecutive failures. Transient failures that recover within the first attempts no longer flash an error, and a dashboard that errored self-heals on the next successful poll.
