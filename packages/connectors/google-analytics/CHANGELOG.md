# @rawdash/connector-google-analytics

## 0.1.0

### Minor Changes

- Initial release of `@rawdash/connector-google-analytics` — a GA4 connector that syncs traffic by day, traffic by source/medium, top pages, events, conversions, and geo data into the six-shape storage model using the GA4 Data API. Authentication supports both Google service accounts (JSON key) and OAuth 2.0 refresh tokens. All six resources are stored as `metric` samples with full dimension and metric attributes available for filtering and aggregation. Backfill (90-day default) and incremental (30-day rolling) sync modes are both supported, with offset-based pagination resumable via cursor.
