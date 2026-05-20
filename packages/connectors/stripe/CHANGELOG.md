# @rawdash/connector-stripe

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
