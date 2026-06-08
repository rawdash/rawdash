---
'@rawdash/connector-mailchimp': minor
---

Add `@rawdash/connector-mailchimp` - syncs Mailchimp campaigns, audiences (lists), and classic automations as entities, plus per-campaign engagement stats (sent, opens, clicks, bounces, unsubscribes) as a metric timestamped at each campaign's send time. Authenticates with a single Marketing API key whose `-<dc>` suffix (e.g. `-us1`) selects the API host, and paginates each list endpoint via `count`/`offset` with `since_send_time` / `since_date_created` filters on the campaigns and lists phases for incremental ticks.
