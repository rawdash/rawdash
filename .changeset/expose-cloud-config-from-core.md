---
'@rawdash/core': minor
'@rawdash/cli': patch
---

Expose cloud-wire body translator from `@rawdash/core`. The `toCloudConfig` function, the `CloudConfig` / `CloudConnector` / `CloudDashboard` types, and matching Zod schemas (`cloudConfigSchema`, `cloudConnectorSchema`, `cloudDashboardSchema`) are now exported from `@rawdash/core` so downstream consumers can produce and validate the wire body without re-implementing it. The CLI now consumes the canonical version from core.
