---
'@rawdash/connector-gcp-billing': patch
---

Fix daily GCP cost overstating spend by ignoring credits. In the Cloud Billing Standard usage cost BigQuery export, the `cost` column is the consumption cost before credits; sustained-use, committed-use, free-tier, and promotional credits are stored separately in the repeated `credits` array (with negative amounts). The connector now nets the `credits` array out of `cost` per row and sums in micros to avoid floating-point drift, so `gcp_cost_daily` reports actual net spend that reconciles with the invoice.
