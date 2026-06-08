---
'@rawdash/connector-azure-monitor': minor
'@rawdash/connector-azure-cost': minor
---

Add `@rawdash/connector-azure-monitor` and `@rawdash/connector-azure-cost` — two new connectors for Microsoft Azure that authenticate with a single Entra ID (Azure AD) service principal (`tenantId` + `clientId` + `clientSecret`) and read from the Azure Resource Manager APIs.

- `@rawdash/connector-azure-monitor` pulls user-declared Azure Monitor metric queries (one query per resource URI + metric namespace + metric + aggregation) into `metric` samples, and subscription-scoped Azure Monitor alerts as `azure_alert` entities. Configure metric queries explicitly; there is no automatic resource discovery.
- `@rawdash/connector-azure-cost` pulls daily ActualCost from the Cost Management `query` endpoint into `azure_cost_daily` metric samples, optionally broken down by up to two grouping dimensions (e.g. `ServiceName`, `ResourceGroup`, or `TAG:Environment`).

Both connectors share an OAuth2 client-credentials token-exchange flow against `login.microsoftonline.com` scoped to `https://management.azure.com/.default`, with the access token cached for its `expires_in` lifetime minus a 60s buffer. The `Azure-Monitor` connector paginates alerts via `nextLink`, and the `Azure-Cost` connector follows the Cost Management `properties.nextLink` continuation token; both sanitize the URL to `management.azure.com` before reuse so a corrupted cursor cannot exfiltrate the bearer token.
