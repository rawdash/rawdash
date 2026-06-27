---
'@rawdash/connector-twilio': patch
'@rawdash/connectors': patch
---

Add `@rawdash/connector-twilio`, a new connector that syncs Twilio SMS/MMS message and voice call events (with status, error code, direction, price, and segment counts) plus daily per-category usage metrics (count and spend) from the Twilio REST API. Authenticated over HTTP Basic auth with an Account SID and Auth token. Drives send-volume and spend stats, daily volume / spend timeseries, and per-category distributions.
