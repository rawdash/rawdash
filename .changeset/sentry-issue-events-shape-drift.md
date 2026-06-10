---
'@rawdash/connector-sentry': patch
---

Update the Sentry `issue_events` schema to match newly observed payloads: additional optional event-level fields (`crashFile`, `culprit`, `event.type`, `location`, `metadata`, `projectID`, `tags`, `title`, `user`).
