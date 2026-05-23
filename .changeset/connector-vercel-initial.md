---
'@rawdash/connector-vercel': minor
---

Add `@rawdash/connector-vercel` — syncs Vercel projects, deployments, and deployment state-transition events into the six-shape storage model. Authenticates with a Vercel access token (optionally scoped to a `teamId`). Backfills with cursor pagination over `/v9/projects` and `/v6/deployments`, then runs incremental sync via the `since` query param. Pairs with `@rawdash/connector-github` for "is this deploy healthy" widgets.
