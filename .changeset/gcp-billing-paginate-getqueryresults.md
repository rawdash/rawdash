---
'@rawdash/connector-gcp-billing': patch
---

Fix BigQuery result pagination. `runQuery` previously re-issued `POST /bigquery/v2/projects/{projectId}/queries` with `body.pageToken` to fetch later pages, but `jobs.query` ignores `pageToken`, so the same first page was re-fetched and the paging loop could run indefinitely once a result set exceeded `maxResults`. Subsequent pages are now fetched via `jobs.getQueryResults` (`GET /bigquery/v2/projects/{projectId}/jobs/{jobId}?pageToken=...&location=...`), threading the `jobReference` returned by the initial query through the paging loop.
