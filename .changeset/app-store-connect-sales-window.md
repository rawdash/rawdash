---
'@rawdash/connector-app-store-connect': patch
---

Fix `app_installs` / `app_revenue` losing history on incremental syncs. The sales-report sync replaced the entire metric on every run, so a `latest` sync — which only re-pulls the last few days, and which Apple returns 404 (zero sales) for on quiet days — wiped all previously synced installs/revenue history, leaving an empty time series and an unstable aggregate. The sync now scopes its write to the fetched report-date window (`replaceWindow`), refreshing only those days and preserving older retained samples.
