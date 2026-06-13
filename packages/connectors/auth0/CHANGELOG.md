# @rawdash/connector-auth0

## 0.24.0

### Patch Changes

- 38fde14: Add `@rawdash/connector-auth0` - syncs users, login events (success, failure, token exchange, change-password failures), and daily logins/signups metrics from an Auth0 tenant via the Management API. Authenticates with a Machine-to-Machine application client-credentials grant and supports a `resources` allowlist plus a `statsLookbackDays` window for the daily-stats refresh.
- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0
