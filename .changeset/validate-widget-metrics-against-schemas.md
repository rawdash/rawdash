---
'@rawdash/core': minor
'@rawdash/server': minor
'@rawdash/hono': minor
'@rawdash/cli': minor
'@rawdash/connector-stripe': minor
---

Validate widget metric definitions against connector resource schemas.

`@rawdash/core` now exports `validateConfigMetrics(config, resourcesByConnectorId)` (plus `resourcesByConnectorIdFromRegistry` to derive that map from a `ConnectorRegistry`). It checks every widget metric against the referenced connector's declared resources and reports:

- **Errors** for a metric that references an unknown resource name, a shape that doesn't match the resource, or a field (including filter/groupBy fields) the resource doesn't declare — each message lists the valid options.
- **Warnings** for aggregating a field declared in a minor currency unit (e.g. Stripe `amount` in cents) without conversion, and for a metric whose title/name implies a time window but has no effective `window`.

Validation runs server-side, where the connector registry (and therefore every connector's schema) already lives: the engine exposes a `POST /config/validate` route (`@rawdash/hono` `createConfigValidateRouter`, mounted by `mountEngine`). `rawdash deploy` calls this route and fails on errors / surfaces warnings before applying, and degrades gracefully if the server doesn't expose it. The CLI no longer bundles the connector packages.

`ResourceField` gains an optional `unit`, and the Stripe connector declares its monetary fields (`amount`, `mrrAmount`, `amountDue`, `amountPaid`) in `cents` so the cents-without-conversion warning is driven by the connector's own schema.
