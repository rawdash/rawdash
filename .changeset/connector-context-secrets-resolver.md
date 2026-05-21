---
'@rawdash/core': patch
---

Add optional `secretsResolver` to `ConnectorContext`. When provided, `BaseConnector` resolves credential `Secret` references through it instead of falling back to `EnvSecretsResolver`. Enables hosts (e.g. rawdash cloud) to inject their own secret backend without subclassing connectors.
