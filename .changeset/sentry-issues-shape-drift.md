---
'@rawdash/connector-sentry': patch
---

Update the Sentry `issues` schema to match newly observed payloads: richer `project` ref fields, ISO datetime validation for the seer/priority timestamps, a `project.id` that accepts string or number, and additional optional issue-level fields.
