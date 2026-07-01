---
'@rawdash/connector-bill': patch
---

Add a BILL (Bill.com) connector that syncs accounts-payable bills, vendors, and vendor payments via the BILL v3 API. Signs in with a developer key, username, password, and organization ID to obtain a session, then paginates each resource with cursor-based `nextPage` navigation. Supports backfill plus incremental sync (filtering on `updatedTime` so status transitions are re-fetched) and per-resource selection. Bills and vendors are stored as entities; payments as events timestamped at their process date.
