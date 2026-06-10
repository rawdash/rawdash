# @rawdash/connector-google-play-console

## 0.22.0

### Minor Changes

- 47aefb7: Add `@rawdash/connector-google-play-console` - syncs Google Play Console app vitals (crash rate, ANR rate, average rating, error count) from the Play Developer Reporting API into the six-shape storage model. Authentication uses a Google service account JSON key linked to the Play Console developer account. Backfill defaults to a trailing 30 days; incremental syncs refetch the trailing 3 days to absorb the standard Reporting API lag. Install counts and earnings are not yet covered (Google delivers those only as monthly Cloud Storage CSV reports) and will land in a follow-up.

### Patch Changes

- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [afbf954]
  - @rawdash/core@0.22.0
