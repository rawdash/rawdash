---
'@rawdash/connector-github': patch
'@rawdash/connector-stripe': patch
'@rawdash/connector-google-analytics': patch
---

Add `default` export pointing at the connector class on every `@rawdash/connector-*` package. Enables symbol-name-agnostic build-time codegen for rawdash cloud's connector registry. Existing named exports (`GitHubConnector`, `StripeConnector`, `GA4Connector`) are unchanged.
