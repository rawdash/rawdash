---
'@rawdash/adapter-libsql': minor
---

Add `migrateIfNeeded(client)` helper for cheap, idempotent schema bootstrap. Uses a single-roundtrip probe to check whether the latest bundled migration is already applied, and delegates to `applyMigrations` only when missing or stale. Lets callers safely run schema bootstrap on every connection open without paying the full migration-check cost on the happy path.
