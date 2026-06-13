# @rawdash/connector-openai

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
