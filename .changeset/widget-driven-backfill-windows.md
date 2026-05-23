---
'@rawdash/core': patch
'@rawdash/server': patch
'@rawdash/connector-github': patch
'@rawdash/connector-google-analytics': patch
'@rawdash/connector-linear': patch
'@rawdash/connector-sentry': patch
'@rawdash/connector-stripe': patch
'@rawdash/connector-vercel': patch
---

Scope OSS sync to widget-driven backfill windows.

`runSync` previously called every configured connector with `mode: 'full'` and no `since`, so connectors paginated all of upstream history on every sync — blowing past the 1000-chunk safety cap on real-world repos and making the example dashboards un-syncable.

`computeConnectorBackfill` (new in `@rawdash/core`) walks `config.dashboards.*.widgets`, groups them by connector name, and computes the max window per connector. Status widgets count as references; current-state widgets with no window keep the connector in the map but leave the window undefined.

`runSync` now skips connectors with zero referencing widgets, and passes `since = now − requiredWindow − 1d buffer` whenever a window is present.

The GitHub connector honors `since` on `pull_requests` (sorted by `updated` desc and stopping at the cutoff), `deployments`, and `releases`. Sentry, Linear, Stripe, Vercel, and Google Analytics also honor `since` under `mode: 'full'` so the widget-driven window flows end-to-end. Stripe subscriptions are intentionally exempt from the `created[gte]` cutoff in full mode because subscription `updated_at` is derived from `current_period_end` and a still-active subscription created before the cutoff would otherwise be dropped.
