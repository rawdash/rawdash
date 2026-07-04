# @rawdash/connector-aws-ses

## 0.29.2

### Patch Changes

- 379c427: Add `@rawdash/connector-aws-ses`, a connector for Amazon SES that reads SES sending and reputation metrics from the AWS/SES CloudWatch namespace. It exposes two daily metric series: `ses_email_stats` (sends, deliveries, bounces, complaints, opens, clicks — account-wide and optionally per configuration set) and `ses_reputation` (account-wide bounce and complaint rates). Authenticates with static IAM keys or an assumed role via the shared AWS auth model and supports backfill plus incremental sync.
- Updated dependencies [5761126]
- Updated dependencies [88c2d08]
- Updated dependencies [58a1086]
- Updated dependencies [322664c]
- Updated dependencies [f0a1c55]
- Updated dependencies [8106c27]
- Updated dependencies [1aba313]
  - @rawdash/core@0.29.2
