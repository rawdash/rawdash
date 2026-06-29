# @rawdash/connector-sendgrid

## 0.29.0

### Patch Changes

- Updated dependencies [48283df]
  - @rawdash/core@0.29.0

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2

## 0.28.1

### Patch Changes

- 6eab449: Add the SendGrid connector. Syncs daily email stats (requests, delivered, bounces, spam reports, opens, clicks, unsubscribes) as a metric from the SendGrid Stats API — globally or broken down by configured category — plus bounce and spam-report events from the Suppressions API. Authenticates with a Web API v3 key, supports a `resources` allowlist and a configurable backfill window, and runs in both backfill and incremental modes.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1
