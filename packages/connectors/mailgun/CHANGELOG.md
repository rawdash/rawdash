# @rawdash/connector-mailgun

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2

## 0.28.1

### Patch Changes

- 4d0d632: Add a Mailgun connector that syncs daily transactional email metrics (accepted, delivered, failed, opens, clicks, unsubscribes, complaints) via the Analytics Metrics API and a bounded sample of recent delivery events via the Analytics Logs API. Supports US and EU regions, HTTP basic auth with an API key, backfill plus incremental sync, and per-domain filtering. Incremental metric syncs replace only the refreshed window so older history is preserved.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1
