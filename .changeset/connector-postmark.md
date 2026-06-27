---
'@rawdash/connector-postmark': patch
---

Add the Postmark connector. Syncs daily outbound email stats (sent, delivered, bounces, spam complaints, opens) as a per-day metric and individual bounce records as events, using a Postmark server API token. The metric merges the four outbound-stats endpoints keyed by date and writes a bounded window so incremental syncs preserve older history; bounces are fetched over a rolling lookback window. Backfill and incremental modes are both supported.
