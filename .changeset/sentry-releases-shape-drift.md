---
'@rawdash/connector-sentry': patch
---

Update the Sentry `releases` schema to match newly observed payloads: `dateReleased` and `lastEvent` became nullable/optional, plus additional optional fields on each release (`authors`, `commitCount`, `currentProjectMeta`, `data`, `deployCount`, `firstEvent`, `id`, `lastCommit`, `lastDeploy`, `newGroups`, `owner`, `ref`, `shortVersion`, `status`, `url`, `userAgent`, `versionInfo`) and on nested `projects` (`hasHealthData`, `id`, `name`, `newGroups`, `platform`, `platforms`).
