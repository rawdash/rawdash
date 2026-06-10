---
'@rawdash/connector-google-analytics': patch
'@rawdash/connector-google-search-console': patch
'@rawdash/connector-google-ads': patch
---

Migrate the Google-API connectors to the shared `GcpAccessTokenProvider` from `@rawdash/connector-gcp-shared` instead of connector-local JWT signing and OAuth token handling. No behavior change — the token requests are identical; this removes duplicated service-account and refresh-token auth code so a fix to GCP auth only has to land in one place.
