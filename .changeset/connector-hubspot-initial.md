---
'@rawdash/connector-hubspot': minor
---

Add `@rawdash/connector-hubspot` — syncs HubSpot CRM contacts, companies, and deals (as entities), deal stage-change events (from deal property history), and marketing email campaigns + per-campaign stats into the six-shape storage model. Authenticates with a private app access token. Backfills and incrementally syncs CRM objects via the Search API (`hs_lastmodifieddate` filter + `after` cursor), and serves `count(...)` widgets directly from the Search API `total` so stat widgets don't force a full backfill.
