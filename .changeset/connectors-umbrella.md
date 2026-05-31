---
'@rawdash/connectors': minor
---

Add `@rawdash/connectors` — a single umbrella package that aggregates every built-in connector, generated at build time from the connector packages in this monorepo. Consumers depend on this one package instead of listing each `@rawdash/connector-*` individually, so adding a connector flows in automatically with no consumer-side changes and no version drift. Two subpath exports keep the metadata-only boundary: `@rawdash/connectors/metadata` re-exports each connector's `doc`, `configFields`, `resources`, and `cost` (tree-shakeable, never the sync logic), while `@rawdash/connectors/registry` exposes the runnable connector classes behind per-connector lazy `import()` loaders. Regenerated and drift-checked via `pnpm gen:connectors-package`.
