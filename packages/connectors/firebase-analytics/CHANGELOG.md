# @rawdash/connector-firebase-analytics

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
