---
'@rawdash/connector-discord': patch
'@rawdash/connectors': patch
---

Add the Discord connector. Syncs guild channels and members (entities), member lifecycle events (joins derived from member join timestamps, plus kicks and bans from the audit log within a rolling lookback window), and daily per-channel message volume with distinct-author counts (a metric derived from the REST message-history endpoint and rewritten over the lookback window on every sync). Authenticates with a bot token and a guild ID, requires the privileged Server Members Intent for member data, and supports a `resources` allowlist, a configurable lookback window, a per-channel message-scan cap, and an optional channel allowlist. Drives member-count and joins-today stats, member-growth and message-volume timeseries, and per-channel activity distributions. Voluntary member leaves require the realtime gateway and are out of scope.
