# @rawdash/connector-expensify

## 0.29.2

### Patch Changes

- c5bfcc7: Add the Expensify connector. Syncs expense reports as entities (total, currency, workflow status, submitter, submit/approve dates), individual expenses as events (merchant, amount, currency, category, parent report), and daily category spend as a per-(day, category, currency) metric. Auth uses Expensify Integration Server partner credentials (partnerUserID + partnerUserSecret); report data is pulled via the combinedReportData export (generate + download) over a rolling lookback window, so backfill and incremental modes are both supported and resyncs are idempotent. Category-spend metric history outside the window is preserved across incremental syncs.
- Updated dependencies [5761126]
- Updated dependencies [88c2d08]
- Updated dependencies [58a1086]
- Updated dependencies [322664c]
- Updated dependencies [f0a1c55]
- Updated dependencies [8106c27]
- Updated dependencies [1aba313]
  - @rawdash/core@0.29.2
