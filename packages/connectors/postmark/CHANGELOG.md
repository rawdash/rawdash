# @rawdash/connector-postmark

## 0.29.0

### Patch Changes

- Updated dependencies [48283df]
  - @rawdash/core@0.29.0

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2

## 0.28.1

### Patch Changes

- bad157b: Add the Postmark connector. Syncs daily outbound email stats (sent, delivered, bounces, spam complaints, opens) as a per-day metric and individual bounce records as events, using a Postmark server API token. The metric merges the four outbound-stats endpoints keyed by date and writes a bounded window so incremental syncs preserve older history; bounces are fetched over a rolling lookback window. Backfill and incremental modes are both supported.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1
