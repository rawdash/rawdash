---
'@rawdash/connector-hacker-news': patch
---

Add the Hacker News connector. It watches Hacker News for story submissions of your configured domains (`hn_submission` entities) and comment mentions of your configured queries (`hn_mention` entities), and records a daily `hn_submission_metric` snapshot per submission carrying score (value), comment count, and current front-page rank. Data comes from the public Algolia HN Search API with no authentication, paginated newest-first with a configurable backfill lookback and an incremental refresh window; the metric writes only replace the current day so prior-day snapshots accumulate into a points/comments trajectory that Hacker News itself does not expose.
