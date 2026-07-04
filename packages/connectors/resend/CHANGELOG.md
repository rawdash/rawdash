# @rawdash/connector-resend

## 0.29.2

### Patch Changes

- 8d0065d: Add the Resend connector. It syncs sent-email activity as `resend_email` events (carrying the sender, sending domain, subject, recipient count, and latest delivery state) and sending domains as `resend_domain` entities (verification status, region, capabilities) from the Resend API into the six-shape storage model, with newest-first paging, an incremental `since` short-circuit, and a configurable full-sync lookback window. Send volume, delivery, and bounce rates are derived at the widget level from the email event stream, since Resend exposes no aggregate-stats API.
- Updated dependencies [5761126]
- Updated dependencies [88c2d08]
- Updated dependencies [58a1086]
- Updated dependencies [322664c]
- Updated dependencies [f0a1c55]
- Updated dependencies [8106c27]
- Updated dependencies [1aba313]
  - @rawdash/core@0.29.2
