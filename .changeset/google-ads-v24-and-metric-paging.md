---
'@rawdash/connector-google-ads': patch
---

Fix two Google Ads connector defects. The connector targeted the sunset `v18` API endpoint (retired 2025-08-20), so every request failed; it now targets `v24`. Metric phases also wrote each page with a replace-by-name batch, so any metric exceeding one 10,000-row page persisted only its final page — metric pages now append, preserving every page.
