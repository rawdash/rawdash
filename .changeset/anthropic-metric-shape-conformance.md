---
'@rawdash/connector-anthropic': minor
---

Declare the metric `attributes` Anthropic carries beyond its primary value so they conform to the metric-shape contract: `ephemeral_1h_input_tokens` and `ephemeral_5m_input_tokens` on `anthropic_cache_creation_tokens` are now `measures`, and `account_id`/`service_account_id` are now declared `dimensions` on the usage metrics. The canonical numeric remains in `value`; no attribute is dropped.
