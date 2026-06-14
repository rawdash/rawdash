---
'@rawdash/connector-appsflyer': patch
---

Fix the AppsFlyer Master API request parameters so the connector returns correct data instead of empty/wrong rows. The install phase now requests `groupings=af_date,pid,c` (the Master API uses `pid` for media source and `c` for campaign, not `af_media_source`/`af_campaign`) and `kpis=installs,cost,revenue,loyal_users` (the previous `conversions` is not a Master API KPI and is replaced by the real `loyal_users` KPI). The retention phase now requests `kpis=retention_day_1,retention_day_7,retention_day_30` grouped by `af_date,pid` (install-day cohort semantics; the previous `retained_users_day_N` KPIs and `cohort_date` grouping do not exist on the Master API and returned nothing). Response schemas and row mappers were aligned to the corrected column names (`pid`, `c`, `loyal_users`, `retention_day_N`), and the `loyalUsers` attribute replaces `conversions` on `appsflyer_install_metrics`.

The sync window is now computed in the configured `timezone` (defaulting to UTC when unset) so the trailing day aligns to the app's reporting day instead of the UTC day, and the rate-limit documentation now reflects the Master API's window-dependent quotas. Resource notes/dimensions and the README were updated accordingly.
