---
'@rawdash/connector-firebase-crashlytics': patch
---

Fix the Crashlytics BigQuery export queries to reference columns that actually exist in the export schema. Both the `crashes_per_day` and `top_issues` queries named columns absent from the export (`application.app_display_version`, `application.bundle_id`, `application.platform`, `issue_title`, `issue_subtitle`), so BigQuery rejected every query with an `Unrecognized name` error and the connector ingested zero data on every sync.

`crashes_per_day` now reads the app version from `application.display_version`, the app identifier from the top-level `bundle_identifier`, and the platform from the top-level `platform`. Fatal crashes are counted via `error_type = 'FATAL'` (the current field; `is_fatal` is deprecated) and de-duplicated by `event_id` so the `firebase_crashlytics.*` wildcard's inclusion of the streamed `_REALTIME` tables no longer double-counts. `top_issues` derives its `title`/`subtitle` from the blamed stack frame (`blame_frame.symbol` / `blame_frame.file`), reads `app_id`/`platform` from the top-level fields, and counts issue events with `COUNT(DISTINCT event_id)`. User counts now exclude anonymous (`''`) ids.
