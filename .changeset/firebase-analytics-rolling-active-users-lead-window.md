---
'@rawdash/connector-firebase-analytics': patch
---

Fix understated weekly/monthly active users in the `firebase_dau_wau_mau` metric. The GA4 Data API's `active7DayUsers` and `active28DayUsers` are trailing rolling counts ending on each report row's date, computed using only events within the requested date range, so the leading days of any window were understated (the first 6 days for WAU, the first 27 for MAU) — and incremental syncs' 30-day `replaceWindow` overwrote previously-correct values with understated ones on every run. The DAU/WAU/MAU report is now queried with a 27-day lead window before the requested start; the lead rows are dropped so only the requested range is persisted and `replaceWindow` stays bounded to it, keeping weekly/monthly counts accurate on every stored day. `firebase_events_per_day` and `firebase_retention` use no rolling-window metrics and are unchanged.
