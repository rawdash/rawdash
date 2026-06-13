---
'@rawdash/connector-auth0': patch
---

Add `@rawdash/connector-auth0` - syncs users, login events (success, failure, token exchange, change-password failures), and daily logins/signups metrics from an Auth0 tenant via the Management API. Authenticates with a Machine-to-Machine application client-credentials grant and supports a `resources` allowlist plus a `statsLookbackDays` window for the daily-stats refresh.
