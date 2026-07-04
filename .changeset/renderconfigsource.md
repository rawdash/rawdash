---
'@rawdash/core': patch
---

Add `renderConfigSource(config)`, a serializer that renders a `DashboardConfig` back to `rawdash.config.ts` source — the inverse of `defineConfig`/`defineMetric`/`secret`. It owns the authoring-shape round-trip (`metric.connectorId` → `defineMetric({ connector: { name } })`, `{ $secret }` markers → `secret("…")`), so downstream consumers no longer need to re-encode that mapping themselves.
