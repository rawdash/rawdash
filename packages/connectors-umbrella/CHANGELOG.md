# @rawdash/connectors

## 0.17.0

### Minor Changes

- 1f605c2: Add `@rawdash/connectors` — a single umbrella package that aggregates every built-in connector, generated at build time from the connector packages in this monorepo. Consumers depend on this one package instead of listing each `@rawdash/connector-*` individually, so adding a connector flows in automatically with no consumer-side changes and no version drift. Two subpath exports keep the metadata-only boundary: `@rawdash/connectors/metadata` re-exports each connector's `doc`, `configFields`, `resources`, and `cost` (tree-shakeable, never the sync logic), while `@rawdash/connectors/registry` exposes the runnable connector classes behind per-connector lazy `import()` loaders. Regenerated and drift-checked via `pnpm gen:connectors-package`.

### Patch Changes

- Updated dependencies [27e0a6d]
- Updated dependencies [78ce58e]
- Updated dependencies [4481cef]
- Updated dependencies [189a912]
- Updated dependencies [c89abb8]
- Updated dependencies [a36406e]
  - @rawdash/connector-google-ads@0.17.0
  - @rawdash/connector-google-search-console@0.17.0
  - @rawdash/connector-intercom@0.17.0
  - @rawdash/connector-salesforce@0.17.0
  - @rawdash/connector-datadog@0.17.0
  - @rawdash/connector-meta-ads@0.17.0
  - @rawdash/core@0.17.0
  - @rawdash/connector-aws-cloudwatch@0.17.0
  - @rawdash/connector-github@0.17.0
  - @rawdash/connector-google-analytics@0.17.0
  - @rawdash/connector-stripe@0.17.0
  - @rawdash/connector-linear@0.17.0
  - @rawdash/connector-sentry@0.17.0
  - @rawdash/connector-vercel@0.17.0
  - @rawdash/connector-aws-cost@0.17.0
  - @rawdash/connector-hubspot@0.17.0
  - @rawdash/connector-jira@0.17.0
  - @rawdash/connector-mixpanel@0.17.0
  - @rawdash/connector-posthog@0.17.0
