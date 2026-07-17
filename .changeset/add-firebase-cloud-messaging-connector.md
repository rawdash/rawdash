---
'@rawdash/connector-firebase-cloud-messaging': patch
---

Add the Firebase Cloud Messaging connector. It reads the FCM -> BigQuery delivery export and syncs two metric resources into the six-shape storage model: `messages_per_day` (per date and platform: accepted sends, deliveries, and an approximate daily delivery rate) and `messages_per_topic` (the same, per topic, for topic sends, capped at a configurable number of topics per day). Authenticates with a Google service account JSON key (BigQuery Data Viewer on the export dataset + BigQuery Job User on the project), supports a configurable full-sync lookback window, and refetches a short trailing window on incremental syncs while preserving retained history. Notification opens and per-topic subscriber counts are not part of the delivery export and are therefore out of scope.
