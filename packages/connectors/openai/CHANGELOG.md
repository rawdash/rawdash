# @rawdash/connector-openai

## 0.28.1

### Patch Changes

- 9ec9550: Fix metric history loss on incremental syncs. These connectors write historical, past-dated metric samples but re-pull only a short trailing window on incremental (`latest`) syncs, then replaced the whole metric by name — so each incremental sync wiped all previously retained history outside that short window, leaving empty time series and unstable aggregates. Each sales/usage/cost metric write is now scoped to the report window the sync actually fetched (`replaceWindow`), refreshing only those days/hours and preserving older retained samples. Same root cause and fix as the App Store Connect change.
- Updated dependencies [8d02825]
  - @rawdash/core@0.28.1

## 0.28.0

### Patch Changes

- 0e4102e: Declare the secondary token breakdowns OpenAI carries in metric `attributes` as `measures` so they conform to the metric-shape contract: `input_cached_tokens` and `input_audio_tokens` on `openai_completions_input_tokens`, and `output_audio_tokens` on `openai_completions_output_tokens`. The canonical token count remains in `value`; no attribute is dropped.
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

### Minor Changes

- 70d0c0f: Add `@rawdash/connector-openai`, a new connector that syncs the OpenAI organization Usage and Costs admin APIs into twelve daily metric series: completions input / output tokens + requests, embeddings input tokens + requests, images count + requests, audio_speeches characters + requests, audio_transcriptions seconds + requests, and cost in USD. Authenticates with an OpenAI admin API key (sk-admin-) and supports optional organization and project-id scoping; lookback window defaults to 30 days (capped at 180).

### Patch Changes

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0
