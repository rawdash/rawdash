# @rawdash/connector-posthog

## 0.16.0

### Minor Changes

- 591fdea: Add `@rawdash/connector-posthog` — syncs PostHog product analytics into the six-shape storage model: feature flags (as entities), per-day event volume and feature-flag usage (HogQL rollups), DAU/WAU/MAU (a single Trends query split by `window` attribute), and declared funnels (one FunnelsQuery per funnel, with per-step conversion rates). Authenticates with a personal API key against PostHog Cloud (US/EU) or a self-hosted host. Backfills over a configurable lookback window and incrementally syncs by passing `options.since` into the rollup window; feature flags paginate by offset and funnels by index so interrupted syncs resume.

### Patch Changes

- Updated dependencies [422b711]
- Updated dependencies [79fdd64]
- Updated dependencies [a1c4c66]
- Updated dependencies [074ec25]
- Updated dependencies [022cbf1]
- Updated dependencies [e104540]
- Updated dependencies [9169ceb]
- Updated dependencies [5026a5b]
- Updated dependencies [c27c332]
- Updated dependencies [e8b014a]
- Updated dependencies [7060534]
- Updated dependencies [d52a6a8]
- Updated dependencies [d17a523]
  - @rawdash/core@0.16.0
