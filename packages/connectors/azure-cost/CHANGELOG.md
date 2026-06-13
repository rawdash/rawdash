# @rawdash/connector-azure-cost

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
