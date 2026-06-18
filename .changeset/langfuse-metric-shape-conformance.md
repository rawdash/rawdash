---
'@rawdash/connector-langfuse': minor
---

Standardize the `langfuse_observations_per_day` and `langfuse_scores` metric output to the canonical metric-shape contract. The canonical numeric now lives only in the `MetricSample` `value` field and is no longer mirrored into `attributes`. For observations, `model` remains a `dimension` while `inputTokens`, `outputTokens`, `totalTokens`, and `costUsd` are declared as `measures` (the observation count is carried only in `value`, no longer also as `countObservations`). For scores, the score name is now the `scoreName` dimension (renamed from the reserved `name`) and `count` is a `measure`; the mean score is carried only in `value`, no longer also as `average`.
