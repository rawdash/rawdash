---
'@rawdash/connector-twilio': patch
---

Stop the Twilio connector from destroying data on every paged and incremental sync.

Each fetched page previously replaced the whole stored resource by name, so a window spanning more than one page of Messages, Calls or daily Usage Records kept only its final page, and every incremental sync erased history older than the refetched window. Messages and calls are now cleared once per full backfill and appended thereafter, and usage samples replace only the `StartDate`–`EndDate` range actually requested.

Also honors a per-sync `options.resources` narrowing by resource name — including writing `twilio_usage_count` and `twilio_usage_price` only when each is selected — and accepts a daily Usage Record `price` whether the API returns it as a number or a quoted string.
