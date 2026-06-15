---
'@rawdash/connector-entra-id': patch
---

Reuse the shared Microsoft Entra ID token mint from `azure-shared` (the same OAuth 2.0 client-credentials flow the Azure ARM connectors use) instead of an inline copy. The connector now classifies token-endpoint auth failures: a bad client secret fails fast as a fatal auth error instead of being retried as a transient error.
