---
'@rawdash/connector-branch': minor
---

Standardize the `branch_install_metrics` metric output to the canonical metric-shape contract. The canonical `installs` count now lives only in the `MetricSample` `value` field and is no longer mirrored into `attributes`. `opens` and `conversions` are declared as `measures`; `date`, `channel`, and `campaign` remain `dimensions`.
