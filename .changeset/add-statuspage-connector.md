---
'@rawdash/connector-statuspage': minor
---

Add `@rawdash/connector-statuspage` - syncs Atlassian Statuspage components, incidents, and per-update incident timeline events. Authenticates with a Statuspage REST API key plus a Page ID; incidents are returned newest-first and bounded by a configurable lookback window (or `options.since` on incremental syncs).
