---
'@rawdash/connector-openai': patch
---

Align the OpenAI connector with the current Organization Usage and Costs admin APIs. The Costs API result has no `organization_id` field and does not support grouping by it, so the `openai_cost_usd` resource no longer declares an always-null `organization_id` dimension. The completions usage request now sends `group_by=batch` so the declared `batch` dimension actually distinguishes Batch API traffic from interactive traffic instead of returning null; grouping does not change totals.
