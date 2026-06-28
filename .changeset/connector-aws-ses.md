---
'@rawdash/connector-aws-ses': minor
---

Add `@rawdash/connector-aws-ses`, a connector for Amazon SES that reads SES sending and reputation metrics from the AWS/SES CloudWatch namespace. It exposes two daily metric series: `ses_email_stats` (sends, deliveries, bounces, complaints, opens, clicks — account-wide and optionally per configuration set) and `ses_reputation` (account-wide bounce and complaint rates). Authenticates with static IAM keys or an assumed role via the shared AWS auth model and supports backfill plus incremental sync.
