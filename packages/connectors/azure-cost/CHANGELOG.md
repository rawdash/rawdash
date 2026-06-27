# @rawdash/connector-azure-cost

## 0.28.1

### Patch Changes

- 9ec9550: Fix metric history loss on incremental syncs. These connectors write historical, past-dated metric samples but re-pull only a short trailing window on incremental (`latest`) syncs, then replaced the whole metric by name — so each incremental sync wiped all previously retained history outside that short window, leaving empty time series and unstable aggregates. Each sales/usage/cost metric write is now scoped to the report window the sync actually fetched (`replaceWindow`), refreshing only those days/hours and preserving older retained samples. Same root cause and fix as the App Store Connect change.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0

## 0.27.0

### Patch Changes

- @rawdash/core@0.27.0

## 0.26.0

### Patch Changes

- 4f88b52: Fix `TAG:<key>` group-bys sending an invalid Cost Management grouping type. The `QueryGrouping.type` enum only accepts `Dimension` or `TagKey`, but tag group-bys were emitting `Tag`, so the Cost Management query API rejected (or silently dropped) the grouping. Tag group-bys now send `type: 'TagKey'`.
  - @rawdash/core@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0

## 0.22.0

### Patch Changes

- beb78ff: Require a `domain` field on connector vendor metadata, and give each connector a vendor domain.

  `connectorDocSchema` now requires `vendor.domain` (a validated hostname), so every connector declares the vendor's domain. This is a breaking change for connector authors using `@rawdash/core` directly. All built-in connectors now set `vendor.domain`.

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0

## 0.21.1

### Patch Changes

- @rawdash/core@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Minor Changes

- 92e7f62: Add `@rawdash/connector-azure-monitor` and `@rawdash/connector-azure-cost` — two new connectors for Microsoft Azure that authenticate with a single Entra ID (Azure AD) service principal (`tenantId` + `clientId` + `clientSecret`) and read from the Azure Resource Manager APIs.
  - `@rawdash/connector-azure-monitor` pulls user-declared Azure Monitor metric queries (one query per resource URI + metric namespace + metric + aggregation) into `metric` samples, and subscription-scoped Azure Monitor alerts as `azure_alert` entities. Configure metric queries explicitly; there is no automatic resource discovery.
  - `@rawdash/connector-azure-cost` pulls daily ActualCost from the Cost Management `query` endpoint into `azure_cost_daily` metric samples, optionally broken down by up to two grouping dimensions (e.g. `ServiceName`, `ResourceGroup`, or `TAG:Environment`).

  Both connectors share an OAuth2 client-credentials token-exchange flow against `login.microsoftonline.com` scoped to `https://management.azure.com/.default`, with the access token cached for its `expires_in` lifetime minus a 60s buffer. The `Azure-Monitor` connector paginates alerts via `nextLink`, and the `Azure-Cost` connector follows the Cost Management `properties.nextLink` continuation token; both sanitize the URL to `management.azure.com` before reuse so a corrupted cursor cannot exfiltrate the bearer token.

### Patch Changes

- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0
