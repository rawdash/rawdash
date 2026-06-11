---
'@rawdash/core': minor
'@rawdash/cli': minor
'@rawdash/connector-stripe': minor
---

Validate widget metric definitions against connector resource schemas.

`@rawdash/core` now exports `validateConfigMetrics(config, resourcesByConnectorId)`, which checks every widget metric against the referenced connector's declared resources and reports:

- **Errors** for a metric that references an unknown resource name, a shape that doesn't match the resource, or a field (including filter/groupBy fields) the resource doesn't declare — each message lists the valid options.
- **Warnings** for aggregating a field declared in a minor currency unit (e.g. Stripe `amount` in cents) without conversion, and for a metric whose title/name implies a time window but has no `window`.

`rawdash validate` and `rawdash deploy` now run this check (sourced from the bundled connector schemas) and fail on errors before contacting the server.

`ResourceField` gains an optional `unit`, and the Stripe connector declares its monetary fields (`amount`, `mrrAmount`, `amountDue`, `amountPaid`) in `cents` so the cents-without-conversion warning is driven by the connector's own schema.
