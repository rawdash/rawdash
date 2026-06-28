# @rawdash/connector-appsflyer

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2

## 0.28.1

### Patch Changes

- 9ec9550: Fix metric history loss on incremental syncs. These connectors write historical, past-dated metric samples but re-pull only a short trailing window on incremental (`latest`) syncs, then replaced the whole metric by name — so each incremental sync wiped all previously retained history outside that short window, leaving empty time series and unstable aggregates. Each sales/usage/cost metric write is now scoped to the report window the sync actually fetched (`replaceWindow`), refreshing only those days/hours and preserving older retained samples. Same root cause and fix as the App Store Connect change.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Minor Changes

- 0e4102e: Standardize the `appsflyer_install_metrics` and `appsflyer_retention_metrics` metric output to the canonical metric-shape contract. The canonical numeric now lives only in the `MetricSample` `value` field and is no longer mirrored into `attributes`. For installs, `cost`, `revenue`, and `loyalUsers` are declared as `measures` while `date`, `mediaSource`, and `campaign` remain `dimensions`; for retention, `cohortDate`, `mediaSource`, and `period` remain `dimensions` and the retained-user count is carried only in `value`.

### Patch Changes

- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0

## 0.27.0

### Patch Changes

- @rawdash/core@0.27.0

## 0.26.0

### Patch Changes

- @rawdash/core@0.26.0

## 0.25.0

### Patch Changes

- cc4eeaa: Fix the AppsFlyer Master API request parameters so the connector returns correct data instead of empty/wrong rows. The install phase now requests `groupings=af_date,pid,c` (the Master API uses `pid` for media source and `c` for campaign, not `af_media_source`/`af_campaign`) and `kpis=installs,cost,revenue,loyal_users` (the previous `conversions` is not a Master API KPI and is replaced by the real `loyal_users` KPI). The retention phase now requests `kpis=retention_day_1,retention_day_7,retention_day_30` grouped by `af_date,pid` (install-day cohort semantics; the previous `retained_users_day_N` KPIs and `cohort_date` grouping do not exist on the Master API and returned nothing). Response schemas and row mappers were aligned to the corrected column names (`pid`, `c`, `loyal_users`, `retention_day_N`), and the `loyalUsers` attribute replaces `conversions` on `appsflyer_install_metrics`.

  The sync window is now computed in the configured `timezone` (defaulting to UTC when unset) so the trailing day aligns to the app's reporting day instead of the UTC day, and the rate-limit documentation now reflects the Master API's window-dependent quotas. Resource notes/dimensions and the README were updated accordingly.

- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0

## 0.22.0

### Minor Changes

- a190bd9: Add `@rawdash/connector-appsflyer`, a new connector that syncs daily install metrics (installs, cost, revenue, conversions by media source and campaign) and cohort retention (retention day 1/7/30 by media source) from the AppsFlyer Master API. Authenticated via a V2.0 bearer API token.

### Patch Changes

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0
