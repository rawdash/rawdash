---
'@rawdash/connector-adp': patch
---

Add the ADP connector. Syncs workers (name, job title, business unit, employment status, hire/termination date from ADP Workforce Now) and employer payroll output per pay cycle (gross / net / taxes / deductions per pay group and pay date, plus a derived payroll-spend metric with a business-unit dimension) into the six-shape storage model. Authenticates with OAuth 2.0 client credentials over the mutual-TLS channel ADP requires; the client certificate and key are surfaced as secrets for the runtime that terminates TLS. Workers are re-fetched in full each sync; payroll is synced over a rolling pay-date window (configurable `lookbackDays`, default 365). A `resources` allowlist is supported. Drives headcount, payroll-spend, and pay-cycle-trend dashboards with per-business-unit distributions.
