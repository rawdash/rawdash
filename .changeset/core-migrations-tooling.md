---
'@rawdash/core': minor
'@rawdash/adapter-turso': minor
---

Add schema migrations tooling for `@rawdash/core`.

- Versioned `.sql` migrations are generated with `drizzle-kit` (dev-only) and shipped under `packages/core/migrations`.
- A new runtime applier (`applyMigrations`, exported from `@rawdash/core`) is bundle-safe (no `fs` at runtime, no `drizzle-orm` in the production bundle), tracks applied tags in a `schema_migrations` table, and applies pending migrations transactionally on startup.
- The applier baselines existing legacy schemas (created via the old `CREATE TABLE IF NOT EXISTS` boot path) so upgrades are non-destructive.
- `@rawdash/adapter-turso` now uses the shared applier and no longer ships its own `drizzle/` folder or runtime drizzle migrator.
