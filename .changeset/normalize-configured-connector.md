---
'@rawdash/core': patch
---

Add `normalizeConfiguredConnector(entry)` and the `DEFAULT_SYNC_INTERVAL_SECONDS` constant (300s) to fill `ConfiguredConnector` defaults — `syncIntervalSeconds ?? 300`, `enabled ?? true`, `displayName ?? name` — in one shared place so hosts and integrators agree on engine policy instead of hand-rolling it. Also exports the `NormalizedConfiguredConnector` type (the same shape with those three fields required). `toWireConfig` now uses this helper.
