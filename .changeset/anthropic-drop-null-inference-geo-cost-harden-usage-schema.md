---
'@rawdash/connector-anthropic': patch
---

Drop the perpetually-null `inference_geo` attribute from `anthropic_cost_usd` samples and harden the usage-report inner schemas. The Cost Report has no `inference_geo` grouping and the attribute was never declared in the connector's cost dimensions, so it was always null; it is now omitted. The `cache_creation` (`ephemeral_1h_input_tokens`, `ephemeral_5m_input_tokens`) and `server_tool_use` (`web_search_requests`) inner fields are now nullish-tolerant, so a present-but-partial object from the Admin API degrades to 0 instead of throwing and aborting the whole page.
