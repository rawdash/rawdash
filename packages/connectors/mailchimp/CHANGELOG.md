# @rawdash/connector-mailchimp

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Minor Changes

- ec274eb: Add `@rawdash/connector-mailchimp` - syncs Mailchimp campaigns, audiences (lists), and classic automations as entities, plus per-campaign engagement stats (sent, opens, clicks, bounces, unsubscribes) as a metric timestamped at each campaign's send time. Authenticates with a single Marketing API key whose `-<dc>` suffix (e.g. `-us1`) selects the API host, and paginates each list endpoint via `count`/`offset` with `since_send_time` / `since_date_created` filters on the campaigns and lists phases for incremental ticks.

### Patch Changes

- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0
