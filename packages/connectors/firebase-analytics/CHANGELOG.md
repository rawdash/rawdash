# @rawdash/connector-firebase-analytics

## 0.28.1

### Patch Changes

- 9ec9550: Fix metric history loss on incremental syncs. These connectors write historical, past-dated metric samples but re-pull only a short trailing window on incremental (`latest`) syncs, then replaced the whole metric by name — so each incremental sync wiped all previously retained history outside that short window, leaving empty time series and unstable aggregates. Each sales/usage/cost metric write is now scoped to the report window the sync actually fetched (`replaceWindow`), refreshing only those days/hours and preserving older retained samples. Same root cause and fix as the App Store Connect change.
- 9cdec6e: Fix every sync failing with `value.trim is not a function` when the service account key is stored as raw JSON. The secrets resolver auto-parses any secret value beginning with `{` into an object, so the shared `parseServiceAccountJson` helper (bundled into each GCP connector) received the already-parsed service account object rather than a string and crashed on `.trim()`. The shared helper now accepts an already-parsed object — validated with the same schema — in addition to a raw JSON string or base64-encoded JSON, and the `GcpAccessTokenProvider` credential contract is typed accordingly.
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

- 0b6099b: New connector `@rawdash/connector-firebase-analytics` that syncs a Firebase project's analytics data through the linked GA4 Data API. Three metric resources: `firebase_dau_wau_mau` (DAU/WAU/MAU per day), `firebase_events_per_day` (per-event counts and active users), and `firebase_retention` (active users by `firstSessionDate` x `date` with a derived `period` attribute for cohort retention). Auth mirrors `@rawdash/connector-google-analytics` (service-account JWT or OAuth refresh-token tuple) and a required `firebaseAppId` labels every sample with the source app. Backfill (90-day default) and incremental (30-day rolling) syncs both honor `options.since` and `options.resources`, with a resumable phase cursor.

### Patch Changes

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0

## 0.1.0

### Minor Changes

- Initial release of `@rawdash/connector-firebase-analytics` - syncs DAU/WAU/MAU, per-event activity, and cohort retention from a Firebase project's linked GA4 property via the GA4 Data API. Authentication supports both Google service accounts (JSON key) and OAuth 2.0 refresh tokens. All three resources are stored as `metric` samples with full dimensions exposed as attributes. Backfill (90-day default) and incremental (30-day rolling) sync modes are both supported, with offset-based pagination resumable via cursor.
