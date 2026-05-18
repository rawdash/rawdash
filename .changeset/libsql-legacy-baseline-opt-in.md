---
'@rawdash/adapter-libsql': minor
---

Gate the legacy-baseline branch in `applyMigrations`/`migrateIfNeeded` behind a new `assumeLegacyBaselineIfEventsExists` option. Previously, any database with a stray `events` table but no `schema_migrations` table would have all migrations marked applied without running them, leaving the schema partially-formed. Now the legacy-baseline behavior only triggers when callers explicitly opt in. `LibsqlStorage` (with the default `initSchema: true`) opts in via `initLibsqlSchema`, preserving OSS backwards-compatibility. Callers that pass `initSchema: false` and invoke `applyMigrations`/`migrateIfNeeded` directly against fresh databases (e.g. cloud per-tenant DBs) now reliably get real migrations.
