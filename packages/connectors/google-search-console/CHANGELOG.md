# @rawdash/connector-google-search-console

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

### Patch Changes

- Updated dependencies [725ebcc]
  - @rawdash/core@0.19.0

## 0.18.0

### Patch Changes

- @rawdash/core@0.18.0

## 0.17.0

### Minor Changes

- 78ce58e: Add `@rawdash/connector-google-search-console` - syncs Google Search Console SEO metrics (clicks, impressions, CTR, average position) for a verified URL-prefix or sc-domain property. Resources cover daily totals plus per-query, per-page, and per-country breakdowns. Authentication supports both a Google service account JSON key and an OAuth 2.0 refresh-token tuple with the `webmasters.readonly` scope. Backfill defaults to a trailing 90 days; incremental syncs refetch the trailing 3 days to absorb Search Console's standard 2-3 day reporting lag.

### Patch Changes

- @rawdash/core@0.17.0
