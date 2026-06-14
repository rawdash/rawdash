---
'@rawdash/connector-circleci': patch
---

Cut off and watermark pipelines on `created_at` instead of `updated_at`. CircleCI sets a pipeline's `updated_at` once at creation and never mutates it (it always equals `created_at`), so the previous cutoff comparison and stored `updated_at` watermark worked only by accident and never advanced meaningfully. The connector now compares the lookback cutoff against `created_at`, watermarks the entity on `created_at`, and drops the redundant `updatedAt` attribute. Pipelines are immutable once created — a re-run surfaces as a new pipeline with a new id and `created_at` — so nothing is lost; this is documented in `limitations` and the resource description.

Fix premature pagination halt. The per-page loop previously set a `crossedCutoff` flag and `continue`d on the first item older than the cutoff, then suppressed the next-page token. A page containing an out-of-order old pipeline before newer ones would stop pagination early and silently drop in-window pipelines on later pages. The loop now scans the whole page into the in-window set and decides the next-page token solely on whether the page's oldest (final) item crosses the cutoff, so a single old item mid-page can no longer halt pagination.

Correct the `rateLimit` doc string (~1,000 requests/minute surfaced via `X-RateLimit-*` headers, not ~3,500/hour) and note that the shared HTTP layer already backs off and retries on 429 via `Retry-After`. Drop the unused `pipeline_number`/`tag` fields from the workflow interface and `dependencies` from the job interface, and rename the written `startedBy` attribute to `startedById` to reflect that CircleCI returns a user UUID.
