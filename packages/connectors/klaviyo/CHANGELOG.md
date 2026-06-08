# @rawdash/connector-klaviyo

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Minor Changes

- 8a6c1e7: Add `@rawdash/connector-klaviyo` - syncs Klaviyo marketing data into the six-shape storage model: lists, segments, campaigns, and flows as entities. Authenticates with a Klaviyo Private API Key; routes requests to `a.klaviyo.com` with the JSON:API revision header. Backfills paginate via JSON:API `links.next` page cursors; incremental syncs add a `greater-than(updated,...)` (or `updated_at` on campaigns) filter so only changed records are streamed. The campaigns endpoint syncs one channel per instance (email, sms, or mobile_push) because Klaviyo requires the filter and does not allow OR across channels.

### Patch Changes

- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0
