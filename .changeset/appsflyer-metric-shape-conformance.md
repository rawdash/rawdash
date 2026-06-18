---
'@rawdash/connector-appsflyer': minor
---

Standardize the `appsflyer_install_metrics` and `appsflyer_retention_metrics` metric output to the canonical metric-shape contract. The canonical numeric now lives only in the `MetricSample` `value` field and is no longer mirrored into `attributes`. For installs, `cost`, `revenue`, and `loyalUsers` are declared as `measures` while `date`, `mediaSource`, and `campaign` remain `dimensions`; for retention, `cohortDate`, `mediaSource`, and `period` remain `dimensions` and the retained-user count is carried only in `value`.
