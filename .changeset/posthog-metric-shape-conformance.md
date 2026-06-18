---
'@rawdash/connector-posthog': minor
---

Standardize PostHog metric output to the canonical metric-shape contract. The primary count/users number now lives only in the `MetricSample` `value` field and is no longer mirrored into `attributes` (removed `count` from `posthog_events_per_day`, `callCount` from `posthog_feature_flag_usage`, and `users` from `posthog_funnel`). Secondary numerics (`distinctUsers`, `uniqueUsers`, `conversionRate`) are now declared as `measures`; categorical fields remain `dimensions`. Reference metric widgets with `field: 'value'` (or omit `field`).
