---
'@rawdash/connector-intercom': patch
---

Fix Intercom contacts incremental sync silently dropping a full day of contact updates. Intercom's contacts search indexes timestamp fields as dates, not datetimes, so it truncates a query value to the start of its UTC day and applies `>` strictly — a precise-second `updated_at >` watermark therefore returned only contacts updated from the following day onward, permanently skipping every contact updated on the watermark day after the cursor. The contacts `updated_at` lower bound is now floored to the start of the watermark's UTC day so the day-truncated, strict comparison includes the entire watermark day (writes are idempotent upserts, so the small bounded re-fetch is harmless). The conversations search path queries `updated_at` at full second precision and is unchanged.
