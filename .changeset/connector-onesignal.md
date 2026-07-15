---
'@rawdash/connector-onesignal': patch
'@rawdash/connectors': patch
---

Add the OneSignal connector. It syncs push and messaging campaigns as `onesignal_notification` entities (carrying delivery counters — successful, failed, errored, converted, received — plus derived delivery and conversion rates and queued/completed timestamps) and daily delivery stats as an `onesignal_notification_stats` metric (recipients targeted per day, with delivered/failed/errored/converted/received measures) from the OneSignal REST API into the six-shape storage model. Authenticates with a REST API key (`Authorization: Key <key>`) scoped to a single app via an App ID, pages the message list newest-first with an incremental `since` short-circuit and a configurable full-sync lookback window, and rewrites the daily stats window on every sync so resyncs are idempotent. Drives send-volume and delivery-rate stats, daily volume and conversion timeseries, and per-message distributions.
