# @rawdash/connector-circleci

## 0.28.1

### Patch Changes

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

- d088f65: Cut off and watermark pipelines on `created_at` instead of `updated_at`. CircleCI sets a pipeline's `updated_at` once at creation and never mutates it (it always equals `created_at`), so the previous cutoff comparison and stored `updated_at` watermark worked only by accident and never advanced meaningfully. The connector now compares the lookback cutoff against `created_at`, watermarks the entity on `created_at`, and drops the redundant `updatedAt` attribute. Pipelines are immutable once created — a re-run surfaces as a new pipeline with a new id and `created_at` — so nothing is lost; this is documented in `limitations` and the resource description.

  Fix premature pagination halt. The per-page loop previously set a `crossedCutoff` flag and `continue`d on the first item older than the cutoff, then suppressed the next-page token. A page containing an out-of-order old pipeline before newer ones would stop pagination early and silently drop in-window pipelines on later pages. The loop now scans the whole page into the in-window set and decides the next-page token solely on whether the page's oldest (final) item crosses the cutoff, so a single old item mid-page can no longer halt pagination.

  Correct the `rateLimit` doc string (~1,000 requests/minute surfaced via `X-RateLimit-*` headers, not ~3,500/hour) and note that the shared HTTP layer already backs off and retries on 429 via `Retry-After`. Drop the unused `pipeline_number`/`tag` fields from the workflow interface and `dependencies` from the job interface, and rename the written `startedBy` attribute to `startedById` to reflect that CircleCI returns a user UUID.
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

- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
  - @rawdash/core@0.23.0

## 0.22.0

### Patch Changes

- beb78ff: Require a `domain` field on connector vendor metadata, and give each connector a vendor domain.

  `connectorDocSchema` now requires `vendor.domain` (a validated hostname), so every connector declares the vendor's domain. This is a breaking change for connector authors using `@rawdash/core` directly. All built-in connectors now set `vendor.domain`.

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0

## 0.21.1

### Patch Changes

- @rawdash/core@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
  - @rawdash/core@0.21.0

## 0.20.0

### Patch Changes

- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [fc7e0d0]
  - @rawdash/core@0.20.0

## 0.19.0

### Minor Changes

- 895222d: Add `@rawdash/connector-circleci` - syncs CircleCI pipelines, workflows, jobs, and workflow state-transition events into the six-shape storage model. Authenticates with a personal API token (`Circle-Token`), scoped to one or more project slugs (`gh/org/repo`, `bb/org/repo`, or `circleci/<orgId>/<projectId>`). Paginates pipelines newest-first per slug, fans out to fetch each pipeline's workflows (and optionally per-workflow jobs), and short-circuits once it crosses the configured lookback window (default 30 days). Jobs are off by default - opt in via `resources` because they add a per-workflow API call.

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0
