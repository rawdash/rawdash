# @rawdash/connector-anthropic

## 0.28.1

### Patch Changes

- 9ec9550: Fix metric history loss on incremental syncs. These connectors write historical, past-dated metric samples but re-pull only a short trailing window on incremental (`latest`) syncs, then replaced the whole metric by name — so each incremental sync wiped all previously retained history outside that short window, leaving empty time series and unstable aggregates. Each sales/usage/cost metric write is now scoped to the report window the sync actually fetched (`replaceWindow`), refreshing only those days/hours and preserving older retained samples. Same root cause and fix as the App Store Connect change.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Patch Changes

- 0e4102e: Declare the metric `attributes` Anthropic carries beyond its primary value so they conform to the metric-shape contract: `ephemeral_1h_input_tokens` and `ephemeral_5m_input_tokens` on `anthropic_cache_creation_tokens` are now `measures`, and `account_id`/`service_account_id` are now declared `dimensions` on the usage metrics. The canonical numeric remains in `value`; no attribute is dropped.
- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0

## 0.27.0

### Patch Changes

- @rawdash/core@0.27.0

## 0.26.0

### Patch Changes

- @rawdash/core@0.26.0

## 0.25.0

### Patch Changes

- d370656: Drop the perpetually-null `inference_geo` attribute from `anthropic_cost_usd` samples and harden the usage-report inner schemas. The Cost Report has no `inference_geo` grouping and the attribute was never declared in the connector's cost dimensions, so it was always null; it is now omitted. The `cache_creation` (`ephemeral_1h_input_tokens`, `ephemeral_5m_input_tokens`) and `server_tool_use` (`web_search_requests`) inner fields are now nullish-tolerant, so a present-but-partial object from the Admin API degrades to 0 instead of throwing and aborting the whole page.
- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0

## 0.23.0

### Minor Changes

- 289f42e: Add `@rawdash/connector-anthropic` — syncs daily Claude token usage (uncached input, output, cache-read, cache-creation), web-search tool requests, and USD spend from the Anthropic Admin Usage and Cost Report endpoints. Authenticates with an organization admin API key (sk-ant-admin-) and supports an optional `workspaceIds` filter plus a `resources` allowlist so usage and cost can be requested independently.

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0
