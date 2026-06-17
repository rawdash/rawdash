---
'@rawdash/connector-langsmith': minor
---

Standardize the `langsmith_runs_per_day` and `langsmith_feedback` metric output to the canonical metric-shape contract. The `langsmith_runs_per_day` run count now lives only in the `MetricSample` `value` field and is no longer mirrored into the `count` attribute; widgets that want the run count use `field: 'value'`. `totalTokens`, `promptTokens`, `completionTokens`, `costUsd`, and `latencyMs` are declared as `measures`; `sessionId`, `sessionName`, `runType`, and `status` remain `dimensions`. For `langsmith_feedback`, the redundant `score` attribute (a mirror of `value`) is removed, `count` and `hasNumericScore` are declared as `measures`, and `key`, `sessionId`, and `runId` remain `dimensions`.
