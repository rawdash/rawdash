# @rawdash/connector-google-play-console

## 0.29.0

### Patch Changes

- Updated dependencies [48283df]
  - @rawdash/core@0.29.0

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2

## 0.28.1

### Patch Changes

- 9ec9550: Fix metric history loss on incremental syncs. These connectors write historical, past-dated metric samples but re-pull only a short trailing window on incremental (`latest`) syncs, then replaced the whole metric by name — so each incremental sync wiped all previously retained history outside that short window, leaving empty time series and unstable aggregates. Each sales/usage/cost metric write is now scoped to the report window the sync actually fetched (`replaceWindow`), refreshing only those days/hours and preserving older retained samples. Same root cause and fix as the App Store Connect change.
- d7108d7: Add install/uninstall statistics to the Google Play Console connector. New `gplay_installs_*` resources (overview, country, app_version, device, os_version, language, carrier) read the monthly `stats/installs` CSV reports from your Play Console Cloud Storage bucket and emit daily install/uninstall/upgrade metrics. Set the new `installsBucketId` config field and grant the service account the Play Console account-level "View app information and download bulk reports" permission (set to Global) to enable them; the existing vitals and ratings resources are unchanged and work without it.
- 9cdec6e: Fix every sync failing with `value.trim is not a function` when the service account key is stored as raw JSON. The secrets resolver auto-parses any secret value beginning with `{` into an object, so the connector received the already-parsed service account object rather than a string, and `parseServiceAccountJson` called `.trim()` on it. `parseServiceAccountJson` now accepts an already-parsed object in addition to a raw JSON string or base64-encoded JSON.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

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

### Minor Changes

- 4b3f3df: Fix the Google Play Console connector so it can run against the live Play Developer Reporting and Android Publisher APIs (previously every sync aborted; tests passed only because the APIs were mocked).
  - **Breaking:** remove the `gplay_ratings_by_day` resource and its `ratings` phase. The Play Developer Reporting API has no `ratingsMetricSet` — the query errored and was rethrown, aborting every sync. A reviews-based rating is a separate follow-up.
  - DAILY metric queries now send `timeZone: { id: 'America/Los_Angeles' }` and the date window is computed in that zone. UTC is only valid for HOURLY aggregation, so the previous UTC window was rejected or silently skewed. The `date` dimension descriptions are relabeled accordingly.
  - Drop the `apps` listings fetch: `GET /androidpublisher/v3/applications/{packageName}/listings` does not exist (listings live only under an edit), so it always 404'd and the title was never populated. The `apps` entity now carries only `package_name`, and the unused `androidpublisher` OAuth scope is removed.
  - Honor `options.resources` via `selectActivePhases`, so a scoped sync no longer queries every metric set.
  - Pass each metric phase's response tag (`crash_rate` / `anr_rate` / `errors`) as the request resource so runtime observations join to the shape-drift baseline; they previously used the metric-set name (`crashRateMetricSet` etc.), which silently disabled drift detection for those metrics.
  - Add a `gplay_app_ratings` metric sourced from the Android Publisher reviews API. It is a rolling sample of recent reviews (configurable via the new `reviewLimit` setting, default 200); each sample carries one review's star rating (1-5) as the value. This replaces the removed `ratingsMetricSet` query — Google exposes ratings only as individual reviews, not as a daily average. The `androidpublisher` OAuth scope is restored for this.

### Patch Changes

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

- 47aefb7: Add `@rawdash/connector-google-play-console` - syncs Google Play Console app vitals (crash rate, ANR rate, average rating, error count) from the Play Developer Reporting API into the six-shape storage model. Authentication uses a Google service account JSON key linked to the Play Console developer account. Backfill defaults to a trailing 30 days; incremental syncs refetch the trailing 3 days to absorb the standard Reporting API lag. Install counts and earnings are not yet covered (Google delivers those only as monthly Cloud Storage CSV reports) and will land in a follow-up.

### Patch Changes

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0
