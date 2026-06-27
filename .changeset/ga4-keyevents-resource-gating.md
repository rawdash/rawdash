---
'@rawdash/connector-google-analytics': patch
---

Google Analytics: request the GA4 Data API `keyEvents` metric instead of the deprecated `conversions` metric (renamed by Google) in the `ga4_traffic_by_source` and `ga4_conversions` resources, and honor `options.resources` so a partial sync only fetches the selected resources (matched by resource name).
