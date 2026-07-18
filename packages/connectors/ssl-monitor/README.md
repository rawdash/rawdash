<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-ssl-monitor

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-ssl-monitor)](https://www.npmjs.com/package/@rawdash/connector-ssl-monitor)
[![license](https://img.shields.io/npm/l/@rawdash/connector-ssl-monitor)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Monitor TLS certificate expiry and health across your domains - one widget that catches an expired certificate before it takes a site down.

## Install

```sh
npm install @rawdash/connector-ssl-monitor
```

## Authentication

No credentials are required. The connector is self-contained: it opens a TLS connection to each configured host and reads the certificate the server presents, exactly as a browser would. Only outbound network access to the monitored hosts on their TLS port is needed.

1. List the hostnames you want to monitor under `domains` (for example example.com).
2. Optionally set a per-domain `port` (defaults to 443) and `severityThresholdDays` (defaults to 30).
3. No secret is required - certificate metadata is public and read during the TLS handshake.

## Configuration

| Field       | Type  | Required | Description                                                                                                   |
| ----------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `domains`   | array | Yes      | The hostnames whose TLS certificates to monitor. Each entry is checked once per sync.                         |
| `resources` | array | No       | Which resources to write. Omit to write both the current certificate entities and the per-check event stream. |

## Resources

- **`ssl_certificate`** _(entity)_ - The TLS certificate a host currently presents, one entity per host:port, with issuer, validity window, days until expiry, and a derived health status.
  - Endpoint: `TLS handshake to {host}:{port}`
  - Read live from the server on each sync via a TLS handshake; there is no upstream API. Unreachable hosts keep their last known certificate entity.
  - `host`: Monitored hostname.
  - `port`: TLS port that was probed.
  - `status`: Derived certificate health: ok | expiring_soon | expired | invalid.
  - `subjectCN`: Certificate subject common name, or null if absent.
  - `issuer`: Issuing authority common name or organization.
  - `validFrom`: Start of the validity window (epoch ms), or null.
  - `validTo`: End of the validity window (epoch ms), or null.
  - `daysUntilExpiry`: Whole days from the sync time until validTo (negative once expired), or null when the validity window is unparseable.
  - `fingerprint`: SHA-256 fingerprint of the certificate.
  - `serialNumber`: Certificate serial number.
  - `subjectAltNames`: Subject alternative names presented by the certificate.
- **`ssl_check`** _(event)_ - One event per host per sync recording the outcome of the TLS check, including unreachable and invalid results that never produce a certificate entity.
  - Endpoint: `TLS handshake to {host}:{port}`
  - Emitted at the sync time. This is the time series behind uptime-style widgets and status transitions.
  - `host`: Monitored hostname.
  - `port`: TLS port that was probed.
  - `status`: Check outcome: ok | expiring_soon | expired | invalid | unreachable.
  - `daysUntilExpiry`: Whole days until expiry at check time, or null when unknown.
  - `message`: Human-readable detail for unreachable or invalid checks, or null when the check succeeded.

## Example

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

const sslMonitor = {
  name: 'ssl-monitor',
  connectorId: 'ssl-monitor',
  config: {
    domains: [
      { host: 'example.com' },
      { host: 'api.example.com', port: 8443, severityThresholdDays: 45 },
    ],
  },
};

export default defineConfig({
  connectors: [sslMonitor],
  dashboards: {
    infrastructure: defineDashboard({
      widgets: {
        expiring_soon: {
          kind: 'stat',
          title: 'Certificates expiring soon',
          metric: defineMetric({
            connector: sslMonitor,
            shape: 'entity',
            entityType: 'ssl_certificate',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'expiring_soon' }],
          }),
        },
        expired: {
          kind: 'stat',
          title: 'Expired certificates',
          metric: defineMetric({
            connector: sslMonitor,
            shape: 'entity',
            entityType: 'ssl_certificate',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'expired' }],
          }),
        },
        checks_per_day: {
          kind: 'timeseries',
          title: 'Certificate checks per day',
          window: '30d',
          metric: defineMetric({
            connector: sslMonitor,
            shape: 'event',
            name: 'ssl_check',
            fn: 'count',
          }),
        },
        certificate_health: {
          kind: 'status',
          title: 'Certificate health',
          source: 'ssl-monitor',
        },
      },
    }),
  },
});
```

## Rate limits

There is no upstream API and no rate limit. Each sync opens one short-lived TLS connection per domain. Control cadence with the connector sync interval; hourly is plenty for expiry monitoring.

## Limitations

- Certificates are read from a live TLS handshake, so there is no historical backfill - the check event stream begins at the first sync and builds up over time.
- A host that cannot be reached is recorded as an unreachable check without a certificate entity; the last known certificate entity from a prior successful sync is retained.
- The signature algorithm is not exposed by the TLS peer-certificate API and is therefore not reported.
- Only the leaf (server) certificate is inspected; intermediate and root chain certificates are not synced.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
