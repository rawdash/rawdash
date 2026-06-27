---
'@rawdash/connector-sendgrid': patch
---

Add the SendGrid connector. Syncs daily email stats (requests, delivered, bounces, spam reports, opens, clicks, unsubscribes) as a metric from the SendGrid Stats API — globally or broken down by configured category — plus bounce and spam-report events from the Suppressions API. Authenticates with a Web API v3 key, supports a `resources` allowlist and a configurable backfill window, and runs in both backfill and incremental modes.
