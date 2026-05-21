# @rawdash/connector-stripe

## 0.12.0

### Minor Changes

- 7139c61: Unify the `static create(input, ctx?)` signature across all connectors so the hosted cloud sync-consumer can register them through a single collapsed registry instead of per-connector adapters.
  - `GitHubActionsConnector.create`, `StripeConnector.create`, `GA4Connector.create` now all take an optional `ConnectorContext` as the second argument and forward it to the constructor. This is the hook the cloud uses to attach a per-sync request observer (RAW-279) without a per-connector adapter knowing how to split raw config into `(settings, creds)`.
  - `StripeConnector.create` and `GA4Connector.create` now return the connector instance directly instead of `{ connector }`. `GitHubActionsConnector.create` already did this; the three are now consistent.
  - `ConnectorFactory.create` in `@rawdash/mcp` is correspondingly typed `(settings: unknown) => Connector` (was `=> ConfiguredConnector`); the `add_connector` tool wraps the bare connector into the `{ connector }` shape that `DashboardConfig.connectors` still uses.

  Breaking:
  - Callers of `StripeConnector.create({...}).connector` or `GA4Connector.create({...}).connector` should drop the `.connector` destructure — `create()` now returns the connector itself.
  - `ConnectorFactory.create` implementations that returned `{ connector }` should return the bare `Connector` instance instead.

### Patch Changes

- @rawdash/core@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [7adee87]
- Updated dependencies [8ee5006]
  - @rawdash/core@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [019b54a]
  - @rawdash/core@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [eae669e]
  - @rawdash/core@0.10.0

## 0.9.0

### Minor Changes

- 52e813f: Add `@rawdash/connector-stripe` — a Stripe billing connector that syncs customers, products, prices, subscriptions, invoices, charges, payment intents, disputes, and refunds into the six-shape storage model. Authentication is via a Stripe Restricted API key; users can scope the connector by passing a `resources` array to sync only a subset. Subscriptions ship with a precomputed `mrrAmount` attribute (monthly-equivalent revenue across all subscription items). Full and incremental sync modes both use Stripe's `starting_after` cursor pagination and are resumable via `paginateChunked`. Stripe Connect platforms can target a connected account by setting `accountId`.

### Patch Changes

- Updated dependencies [533e632]
  - @rawdash/core@0.9.0
