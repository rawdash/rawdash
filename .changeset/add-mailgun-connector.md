---
'@rawdash/connector-mailgun': patch
---

Add a Mailgun connector that syncs daily transactional email metrics (accepted, delivered, failed, opens, clicks, unsubscribes, complaints) via the Analytics Metrics API and a bounded sample of recent delivery events via the Analytics Logs API. Supports US and EU regions, HTTP basic auth with an API key, backfill plus incremental sync, and per-domain filtering. Incremental metric syncs replace only the refreshed window so older history is preserved.
