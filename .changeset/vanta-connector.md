---
'@rawdash/connector-vanta': patch
'@rawdash/connectors': patch
---

Add `@rawdash/connector-vanta`. Syncs controls, tests, and test findings from a Vanta workspace via the Public API (`/v1/controls`, `/v1/tests`, `/v1/test-findings`) for compliance dashboards (audit-ready %, failing-test counts, open finding counts and severity breakdowns). OAuth 2.0 client-credentials auth (default `vanta-api.all:read` scope), cursor pagination, configurable findings lookback window, and full + incremental sync modes.
