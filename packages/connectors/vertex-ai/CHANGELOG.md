# @rawdash/connector-vertex-ai

## 0.29.0

### Patch Changes

- Updated dependencies [48283df]
  - @rawdash/core@0.29.0

## 0.28.2

### Patch Changes

- @rawdash/core@0.28.2

## 0.28.1

### Patch Changes

- 9ec9550: Fix metric history loss on incremental syncs. These connectors write historical, past-dated metric samples but re-pull only a short trailing window on incremental (`latest`) syncs, then replaced the whole metric by name — so each incremental sync wiped all previously retained history outside that short window, leaving empty time series and unstable aggregates. Each sales/usage/cost metric write is now scoped to the report window the sync actually fetched (`replaceWindow`), refreshing only those days/hours and preserving older retained samples. Same root cause and fix as the App Store Connect change.
- 9cdec6e: Fix every sync failing with `value.trim is not a function` when the service account key is stored as raw JSON. The secrets resolver auto-parses any secret value beginning with `{` into an object, so the shared `parseServiceAccountJson` helper (bundled into each GCP connector) received the already-parsed service account object rather than a string and crashed on `.trim()`. The shared helper now accepts an already-parsed object — validated with the same schema — in addition to a raw JSON string or base64-encoded JSON, and the `GcpAccessTokenProvider` credential contract is typed accordingly.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
  - @rawdash/core@0.28.0

## 0.27.0

### Patch Changes

- @rawdash/core@0.27.0

## 0.26.0

### Patch Changes

- @rawdash/core@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [f99cb16]
  - @rawdash/core@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/core@0.24.0

## 0.23.0

### Patch Changes

- 7768223: Add `@rawdash/connector-vertex-ai` — syncs daily Vertex AI model invocations, token counts, errors, and spend (Gemini and partner online-serving models) from Cloud Monitoring and the Cloud Billing BigQuery export into the six-shape storage model. Authenticates with a single GCP service account JSON.
- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0
