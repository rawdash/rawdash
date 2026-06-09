---
'@rawdash/core': minor
'@rawdash/connector-aws-cloudwatch': patch
'@rawdash/connector-aws-cost': patch
'@rawdash/connector-azure-cost': patch
'@rawdash/connector-azure-monitor': patch
'@rawdash/connector-bitbucket': patch
'@rawdash/connector-circleci': patch
'@rawdash/connector-datadog': patch
'@rawdash/connector-gcp-billing': patch
'@rawdash/connector-gcp-monitoring': patch
'@rawdash/connector-github': patch
'@rawdash/connector-gitlab': patch
'@rawdash/connector-google-ads': patch
'@rawdash/connector-google-analytics': patch
'@rawdash/connector-google-search-console': patch
'@rawdash/connector-greenhouse': patch
'@rawdash/connector-hubspot': patch
'@rawdash/connector-intercom': patch
'@rawdash/connector-jira': patch
'@rawdash/connector-klaviyo': patch
'@rawdash/connector-launchdarkly': patch
'@rawdash/connector-linear': patch
'@rawdash/connector-mailchimp': patch
'@rawdash/connector-meta-ads': patch
'@rawdash/connector-mixpanel': patch
'@rawdash/connector-netlify': patch
'@rawdash/connector-new-relic': patch
'@rawdash/connector-posthog': patch
'@rawdash/connector-salesforce': patch
'@rawdash/connector-sentry': patch
'@rawdash/connector-statuspage': patch
'@rawdash/connector-stripe': patch
'@rawdash/connector-vercel': patch
'@rawdash/connector-zendesk': patch
---

Require a `domain` field on connector vendor metadata, and give each connector a vendor domain.

`connectorDocSchema` now requires `vendor.domain` (a validated hostname), so every connector declares the vendor's domain. This is a breaking change for connector authors using `@rawdash/core` directly. All built-in connectors now set `vendor.domain`.
