---
'@rawdash/connector-klaviyo': minor
---

Add `@rawdash/connector-klaviyo` - syncs Klaviyo marketing data into the six-shape storage model: lists, segments, campaigns, and flows as entities. Authenticates with a Klaviyo Private API Key; routes requests to `a.klaviyo.com` with the JSON:API revision header. Backfills paginate via JSON:API `links.next` page cursors; incremental syncs add a `greater-than(updated,...)` (or `updated_at` on campaigns) filter so only changed records are streamed. The campaigns endpoint syncs one channel per instance (email, sms, or mobile_push) because Klaviyo requires the filter and does not allow OR across channels.
