---
'@rawdash/connector-azure-shared': minor
'@rawdash/connector-entra-id': patch
---

Generalize the Azure AD token mint so Microsoft Graph connectors can share it. `fetchArmAccessToken` becomes `fetchEntraAccessToken({ scope, ... })` and `AzureAuthInput` becomes `EntraAuthInput`; the ARM scope now lives in `BaseAzureConnector`. The `entra-id` connector reuses this shared token mint, gaining the auth-error classification (a bad client secret now fails fast as `AuthError` instead of being retried as transient).
