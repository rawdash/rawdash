---
'@rawdash/core': minor
---

Generate connector documentation from connector metadata, and unify per-resource metadata.

- `@rawdash/core`: add `defineResources()` / `schemasFromResources()` and the `ResourceDefinition` type. A connector now declares each stored resource once (shape, description, endpoint, fields/dimensions, notes, and the API-response Zod schema(s) under `responses`); `ConnectorClass.schemas` is derived from these instead of being a separate central map. Connectors expose `static resources` + `static schemas = schemasFromResources(...)`.
- `@rawdash/core`: add `defineConnectorDoc()` for the connector-level docs metadata (display name, category, brandColor, tagline, vendor, auth, rateLimit, limitations). Per-resource docs moved to `resources`; the runnable example moved to a type-checked `src/example.config.ts` per connector. Add the optional `ConnectorCost` contract field (`static cost`) so connectors can report recommended sync interval and cost/quota warnings.
- Each connector's `README.md` and the website's `/docs/connectors` pages (one per connector plus a catalog index, per-connector brand icons, and the landing-page grid data) are generated from this metadata via `pnpm docs:connectors`. CI enforces freshness and a no-em-dash rule with `pnpm docs:connectors:check`.
- `@rawdash/connector-test-utils`: `connectorResourceShapeViolations` / `assertConnectorResourceShapes` verify that every resource a connector writes is declared and that the declared `shape` matches what is written to storage.
