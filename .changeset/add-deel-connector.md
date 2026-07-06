---
'@rawdash/connector-deel': patch
---

Add the Deel connector. Syncs people (workers with country, job title, employment type, start date, and hiring status), contracts (entities carrying type, status, and parsed compensation), and invoices (entities plus derived issued/paid events that carry the invoice total for spend timeseries) from the Deel REST API using an organization API token. Deel exposes no updated-since filter on people or contracts, so those are re-fetched in full and rewritten each sync; invoices are synced over a rolling issued-date window (configurable `lookbackDays`, default 365). A `resources` allowlist is supported. Drives headcount, contractor-spend, and payroll dashboards with per-country and per-employment-type distributions.
