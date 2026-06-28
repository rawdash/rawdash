# @rawdash/connector-entra-id

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2

## 0.28.1

### Patch Changes

- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0

## 0.27.0

### Patch Changes

- 828462c: Add `@rawdash/connector-entra-id` — syncs users, sign-in events, and risky users from a Microsoft Entra ID (formerly Azure AD) tenant via Microsoft Graph. Authenticates with an app registration client-credentials grant and supports a `resources` allowlist plus a `signinsLookbackDays` window for the sign-in event backfill.
- 75021e9: Reuse the shared Microsoft Entra ID token mint from `azure-shared` (the same OAuth 2.0 client-credentials flow the Azure ARM connectors use) instead of an inline copy. The connector now classifies token-endpoint auth failures: a bad client secret fails fast as a fatal auth error instead of being retried as a transient error.
  - @rawdash/core@0.27.0

## 0.1.0

### Minor Changes

- Add `@rawdash/connector-entra-id` — syncs users, sign-in events, and risky users from a Microsoft Entra ID (formerly Azure AD) tenant via Microsoft Graph. Authenticates with an app registration client-credentials grant and supports a `resources` allowlist plus a `signinsLookbackDays` window for the sign-in event backfill.
