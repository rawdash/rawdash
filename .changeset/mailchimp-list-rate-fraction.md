---
'@rawdash/connector-mailchimp': patch
---

Normalize the `mailchimp_list` audience `openRate`/`clickRate` to a 0–1 fraction. The Mailchimp Marketing API returns list-stats `open_rate`/`click_rate` as a percentage between 0 and 100, but the connector stored them verbatim while documenting (and, for the `campaign_stats` metric, computing) rates as a 0–1 fraction. Audience open/click rates were therefore 100× too large and inconsistent with the per-campaign stats. They are now divided by 100 on ingest (`null` preserved), matching the field documentation and the campaign-stats metric.
