# @rawdash/connector-firebase-analytics

## 0.1.0

### Minor Changes

- Initial release of `@rawdash/connector-firebase-analytics` - syncs DAU/WAU/MAU, per-event activity, and cohort retention from a Firebase project's linked GA4 property via the GA4 Data API. Authentication supports both Google service accounts (JSON key) and OAuth 2.0 refresh tokens. All three resources are stored as `metric` samples with full dimensions exposed as attributes. Backfill (90-day default) and incremental (30-day rolling) sync modes are both supported, with offset-based pagination resumable via cursor.
