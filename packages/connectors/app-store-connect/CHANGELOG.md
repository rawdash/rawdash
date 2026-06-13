# @rawdash/connector-app-store-connect

## 0.23.0

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0

## 0.22.0

### Minor Changes

- 851d1f1: Add `@rawdash/connector-app-store-connect` — syncs the team's iOS/macOS apps, daily sales (units and developer proceeds), and a rolling sample of customer review ratings from the App Store Connect REST API into the six-shape storage model. Authenticates with an ES256-signed JWT minted per request from an issuer ID, key ID, and a PKCS#8 EC private key (.p8). Sales reports are fetched as gzipped TSV (DAILY frequency, SALES SUMMARY) and broken out by `(date, app, country, productTypeIdentifier)`; revenue samples preserve each row's native "Currency of Proceeds" so downstream widgets can group or FX-convert. App ratings are sampled from each app's most-recent N customer reviews (default 200, capped at 2,000) and emitted as a metric with rating 1-5 as the value and territory on the attribute, since Apple does not expose lifetime aggregates over the REST API. Per-build crash counts (`app_crashes`) are intentionally deferred — they require the asynchronous Analytics Reports request/poll/download flow which is a follow-up. A new `mobile` connector category is added to `@rawdash/core` so this and future mobile connectors land in a dedicated docs vertical.

### Patch Changes

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0
