---
'@rawdash/connector-firebase-crashlytics': minor
---

Add `@rawdash/connector-firebase-crashlytics` - sync daily crash counts, approximate crash-free user rate, and top issues from the Firebase Crashlytics -> BigQuery export. Authenticates with a Google service account JSON key (BigQuery Data Viewer on the export dataset + BigQuery Job User on the project). Exposes a `crashes_per_day` metric (per app/version/platform/day) and a `top_issues` entity ranked by event count over the backfill window.
