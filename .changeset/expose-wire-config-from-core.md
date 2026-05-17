---
'@rawdash/core': minor
'@rawdash/cli': patch
---

Expose the wire-body translator from `@rawdash/core`. `toWireConfig`, the `WireConfig` / `WireConnector` / `WireDashboard` types, and matching Zod schemas (`wireConfigSchema`, `wireConnectorSchema`, `wireDashboardSchema`) are now exported from `@rawdash/core` so backend implementations can produce and validate the canonical config wire body without re-implementing it. The CLI now consumes this from core instead of duplicating the translation internally.
