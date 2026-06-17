---
'@rawdash/connector-meta-ads': minor
---

Standardize the Meta Ads insights metric output to the canonical metric-shape contract. Across `meta_campaign_insights`, `meta_adset_insights`, and `meta_ad_insights`, the canonical `spend` value now lives only in the `MetricSample` `value` field and is no longer mirrored into `attributes`. `impressions`, `clicks`, `reach`, `conversions`, and `conversion_value` are declared as `measures`; `date`, `campaignId`, `campaignName` (plus `adsetId`/`adsetName` and `adId`/`adName` where applicable) remain `dimensions`.
