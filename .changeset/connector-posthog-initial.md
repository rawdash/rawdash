---
'@rawdash/connector-posthog': minor
---

Add `@rawdash/connector-posthog` — syncs PostHog product analytics into the six-shape storage model: feature flags (as entities), per-day event volume and feature-flag usage (HogQL rollups), DAU/WAU/MAU (a single Trends query split by `window` attribute), and declared funnels (one FunnelsQuery per funnel, with per-step conversion rates). Authenticates with a personal API key against PostHog Cloud (US/EU) or a self-hosted host. Backfills over a configurable lookback window and incrementally syncs by passing `options.since` into the rollup window; feature flags paginate by offset and funnels by index so interrupted syncs resume.
