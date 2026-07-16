---
'@rawdash/connector-revenuecat': minor
---

Ground the RevenueCat connector in its real v2 REST API. RevenueCat has no REST endpoint for listing subscription lifecycle events, so the `events` resource (and its `events` value in the `resources` allowlist) is removed — event data is only delivered via webhooks. The customers list endpoint returns only base fields, so subscriptions are now fetched per customer from `GET /v2/projects/{project_id}/customers/{customer_id}/subscriptions` (previously read from a non-existent embedded array, leaving the subscription table always empty) and active entitlements from `GET /v2/projects/{project_id}/customers/{customer_id}/active_entitlements` (previously always empty). List requests now send `limit=100` (the effective per-page maximum) and follow the `starting_after` cursor returned in `next_page`.
