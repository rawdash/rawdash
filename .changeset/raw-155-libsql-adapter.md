---
'@rawdash/core': minor
'@rawdash/server': minor
'@rawdash/nextjs': minor
'@rawdash/connector-github': minor
'@rawdash/adapter-libsql': minor
'@rawdash/cli': minor
'@rawdash/client': minor
'@rawdash/mcp': minor
---

Consolidate libSQL storage into `@rawdash/adapter-libsql`.

- New package `@rawdash/adapter-libsql` exporting `LibsqlStorage`, a `ServerStorage` backed by libSQL/Turso via Kysely. Works on Node and Cloudflare Workers from the same package.
- Built-in schema migrations: Drizzle schema is the source of truth for `drizzle-kit generate`; runtime applies inlined SQL via a tiny applier (no `fs` / `fileURLToPath`, so Workers-safe).
- Removed `@rawdash/core/libsql` subpath export — use `@rawdash/adapter-libsql` instead.
- Removed `@rawdash/adapter-turso` — replaced by `@rawdash/adapter-libsql`.
