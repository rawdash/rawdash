---
'@rawdash/connector-langfuse': minor
---

Fix Langfuse trace ingestion against the real `GET /api/public/traces` response. The trace list returns each trace's event time as `timestamp`, not `createdAt`/`updatedAt`, so the connector was reading undefined fields: every trace was stored with a `null` creation timestamp and an `updated_at` of `0` (epoch), and the incremental "page is entirely before `since`" short-circuit never fired. Traces now read `timestamp` for the stored `createdAt` attribute, the entity `updated_at`, and the short-circuit, and the list request sends `orderBy=timestamp.desc` so newest-first ordering is guaranteed.

Trace `latency` is returned in seconds but was stored verbatim into the `latencyMs` attribute (documented as milliseconds), making it 1000× too small; it is now converted seconds→ms on ingest (`null` preserved).

Breaking: the `langfuse_trace` resource no longer exposes `projectId`, which the traces list endpoint never returns (it was always `null`). The `langfuse_scores` average now includes only numeric and boolean scores; categorical scores (whose `value` is only a category-index mapping) no longer skew the mean but still increment the count.
