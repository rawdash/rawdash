---
'@rawdash/connector-pipedrive': patch
'@rawdash/connectors': patch
---

Add the Pipedrive connector. It syncs deals as `pipedrive_deal` entities (title, status, value, currency, stage, pipeline, owner, and lifecycle timestamps), deal stage transitions as `pipedrive_deal_stage_change` events derived from each deal's change history (GET /deals/{id}/flow), pipelines as `pipedrive_pipeline` entities, and activities as `pipedrive_activity` entities, from the Pipedrive API v1 into the six-shape storage model. Deals sync incrementally by `update_time` with `start`/`limit` pagination; the stage-change event scope is rewritten on every sync. Authentication uses a personal API token passed as the `api_token` query parameter.
