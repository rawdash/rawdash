---
'@rawdash/connector-meta-ads': patch
---

Fix two Meta Marketing API correctness issues. Bump the default Graph API version from the now-deprecated `v21.0` to `v25.0` (Meta sunset all Marketing API versions prior to v24.0, so default-configured syncs were failing). Derive the daily insights `conversions`/`conversion_value` metrics from Meta's dedicated `conversions`/`conversion_values` Insights fields instead of summing every entry in the generic `actions`/`action_values` arrays, which conflated engagement (link clicks, video views, post engagement) with conversions and double-counted hierarchical action types.
