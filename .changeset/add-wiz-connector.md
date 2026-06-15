---
'@rawdash/connector-wiz': minor
---

Add `@rawdash/connector-wiz` — syncs Wiz cloud-security issues, derived issue lifecycle events, and vulnerability findings via the Wiz GraphQL API. Auth is OAuth 2.0 client-credentials against a Wiz service account; the connector mints and refreshes the access token internally. Backfill and incremental modes both filter on `updatedAt` / `lastDetectedAt`.
