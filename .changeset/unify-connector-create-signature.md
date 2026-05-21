---
'@rawdash/connector-github': minor
'@rawdash/connector-stripe': minor
'@rawdash/connector-google-analytics': minor
'@rawdash/mcp': minor
---

Unify the `static create(input, ctx?)` signature across all connectors so the hosted cloud sync-consumer can register them through a single collapsed registry instead of per-connector adapters.

- `GitHubActionsConnector.create`, `StripeConnector.create`, `GA4Connector.create` now all take an optional `ConnectorContext` as the second argument and forward it to the constructor. This is the hook the cloud uses to attach a per-sync request observer (RAW-279) without a per-connector adapter knowing how to split raw config into `(settings, creds)`.
- `StripeConnector.create` and `GA4Connector.create` now return the connector instance directly instead of `{ connector }`. `GitHubActionsConnector.create` already did this; the three are now consistent.
- `ConnectorFactory.create` in `@rawdash/mcp` is correspondingly typed `(settings: unknown) => Connector` (was `=> ConfiguredConnector`); the `add_connector` tool wraps the bare connector into the `{ connector }` shape that `DashboardConfig.connectors` still uses.

Breaking:

- Callers of `StripeConnector.create({...}).connector` or `GA4Connector.create({...}).connector` should drop the `.connector` destructure — `create()` now returns the connector itself.
- `ConnectorFactory.create` implementations that returned `{ connector }` should return the bare `Connector` instance instead.
