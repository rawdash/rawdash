---
'@rawdash/connector-sentry': patch
---

Fix incremental `sentry_release` syncs silently dropping in-window releases, and count only accepted errors in `sentry_errors_per_hour`.

The `GET /api/0/organizations/{organization}/releases/` list is ordered by `dateCreated` (date added) descending, while `dateReleased` is operator-set, nullable, and non-monotonic across pages. The incremental window now filters and short-circuits pagination on `dateCreated` only (and requests `sort=date` explicitly), so a page whose `dateReleased` values are out of `dateCreated` order no longer terminates pagination early or drops releases whose `dateCreated` is in-window. `dateReleased`/`lastEvent` are still stored as attributes.

The `stats_v2` request for `sentry_errors_per_hour` now sets `outcome=accepted`. Without an outcome filter, `sum(quantity)` aggregates across every outcome (accepted, filtered, rate_limited, invalid, etc.) — total ingested volume rather than accepted (stored) errors — overcounting the intuitive error count.
