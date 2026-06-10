---
'@rawdash/connector-firebase-analytics': minor
'@rawdash/connectors': patch
---

New connector `@rawdash/connector-firebase-analytics` that syncs a Firebase project's analytics data through the linked GA4 Data API. Three metric resources: `firebase_dau_wau_mau` (DAU/WAU/MAU per day), `firebase_events_per_day` (per-event counts and active users), and `firebase_retention` (active users by `firstSessionDate` x `date` with a derived `period` attribute for cohort retention). Auth mirrors `@rawdash/connector-google-analytics` (service-account JWT or OAuth refresh-token tuple) and a required `firebaseAppId` labels every sample with the source app. Backfill (90-day default) and incremental (30-day rolling) syncs both honor `options.since` and `options.resources`, with a resumable phase cursor.
