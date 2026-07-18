---
'@rawdash/connector-ssl-monitor': patch
---

Add the SSL Certificate Monitor connector. It is self-contained and needs no credentials: on each sync it opens a short-lived TLS handshake to every configured host and reads the certificate the server presents. It writes the current certificate per host:port as `ssl_certificate` entities (subject, issuer, validity window, days until expiry, and a derived `ok` / `expiring_soon` / `expired` / `invalid` status) and one `ssl_check` event per host per sync (including `unreachable` and `invalid` outcomes that never yield a certificate entity), so dashboards can surface expiry countdowns, expiring/expired counts, a live health status, and a check time series. There is no historical backfill because certificates are read live from the wire.
