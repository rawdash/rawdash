---
'@rawdash/core': minor
---

Require `resource` on `request()` (via `@rawdash/connector-shared` 0.11.0) and propagate it through `BaseConnector`.

`BaseConnector` now exposes protected `request` / `get` / `post` helpers that take a required `resource` and forward an observer from a new optional `ConnectorContext` (passed as a third constructor argument). Connector authors only add `{ resource: '...' }` to each HTTP call site — no observer plumbing, no `ctx` inspection. The shape-drift pipeline groups observations by `(connector, resource)`, and `resource` being required at the type level is the safety net that prevents unguarded call sites from producing un-attributable observations.

All three OSS connectors (`github-actions`, `stripe`, `google-analytics`) updated to route every HTTP call through the base helpers with a resource name matching their schema keys.
