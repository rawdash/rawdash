# @rawdash/connectors

## 0.28.1

### Patch Changes

- c448ee6: Add `@rawdash/connector-twilio`, a new connector that syncs Twilio SMS/MMS message and voice call events (with status, error code, direction, price, and segment counts) plus daily per-category usage metrics (count and spend) from the Twilio REST API. Authenticated over HTTP Basic auth with an Account SID and Auth token. Drives send-volume and spend stats, daily volume / spend timeseries, and per-category distributions.
- Updated dependencies [4d0d632]
- Updated dependencies [c448ee6]
- Updated dependencies [1d8980b]
- Updated dependencies [bad157b]
- Updated dependencies [6eab449]
- Updated dependencies [9ec9550]
- Updated dependencies [28c0f3d]
- Updated dependencies [9cdec6e]
- Updated dependencies [97b0fd4]
- Updated dependencies [d7108d7]
- Updated dependencies [9cdec6e]
- Updated dependencies [6258ec0]
- Updated dependencies [8d02825]
- Updated dependencies [b35c937]
- Updated dependencies [34a806a]
- Updated dependencies [26f0e81]
- Updated dependencies [a6b6310]
- Updated dependencies [8d06434]
  - @rawdash/connector-mailgun@0.28.1
  - @rawdash/connector-twilio@0.28.1
  - @rawdash/connector-app-store-connect@0.28.1
  - @rawdash/connector-postmark@0.28.1
  - @rawdash/connector-sendgrid@0.28.1
  - @rawdash/connector-anthropic@0.28.1
  - @rawdash/connector-appsflyer@0.28.1
  - @rawdash/connector-openai@0.28.1
  - @rawdash/connector-aws-bedrock@0.28.1
  - @rawdash/connector-aws-cloudwatch@0.28.1
  - @rawdash/connector-aws-cost@0.28.1
  - @rawdash/connector-azure-cost@0.28.1
  - @rawdash/connector-azure-monitor@0.28.1
  - @rawdash/connector-firebase-analytics@0.28.1
  - @rawdash/connector-firebase-crashlytics@0.28.1
  - @rawdash/connector-gcp-billing@0.28.1
  - @rawdash/connector-google-ads@0.28.1
  - @rawdash/connector-google-analytics@0.28.1
  - @rawdash/connector-google-play-console@0.28.1
  - @rawdash/connector-google-search-console@0.28.1
  - @rawdash/connector-mixpanel@0.28.1
  - @rawdash/connector-vertex-ai@0.28.1
  - @rawdash/connector-gcp-monitoring@0.28.1
  - @rawdash/connector-meta-ads@0.28.1
  - @rawdash/core@0.28.1
  - @rawdash/connector-github@0.28.1
  - @rawdash/connector-sentry@0.28.1
  - @rawdash/connector-asana@0.28.1
  - @rawdash/connector-auth0@0.28.1
  - @rawdash/connector-bitbucket@0.28.1
  - @rawdash/connector-branch@0.28.1
  - @rawdash/connector-circleci@0.28.1
  - @rawdash/connector-clerk@0.28.1
  - @rawdash/connector-clickup@0.28.1
  - @rawdash/connector-datadog@0.28.1
  - @rawdash/connector-drata@0.28.1
  - @rawdash/connector-entra-id@0.28.1
  - @rawdash/connector-gitlab@0.28.1
  - @rawdash/connector-greenhouse@0.28.1
  - @rawdash/connector-hubspot@0.28.1
  - @rawdash/connector-intercom@0.28.1
  - @rawdash/connector-jira@0.28.1
  - @rawdash/connector-klaviyo@0.28.1
  - @rawdash/connector-langfuse@0.28.1
  - @rawdash/connector-langsmith@0.28.1
  - @rawdash/connector-launchdarkly@0.28.1
  - @rawdash/connector-linear@0.28.1
  - @rawdash/connector-mailchimp@0.28.1
  - @rawdash/connector-monday@0.28.1
  - @rawdash/connector-netlify@0.28.1
  - @rawdash/connector-new-relic@0.28.1
  - @rawdash/connector-okta@0.28.1
  - @rawdash/connector-posthog@0.28.1
  - @rawdash/connector-revenuecat@0.28.1
  - @rawdash/connector-salesforce@0.28.1
  - @rawdash/connector-shopify@0.28.1
  - @rawdash/connector-statuspage@0.28.1
  - @rawdash/connector-stripe@0.28.1
  - @rawdash/connector-vanta@0.28.1
  - @rawdash/connector-vercel@0.28.1
  - @rawdash/connector-wiz@0.28.1
  - @rawdash/connector-workos@0.28.1
  - @rawdash/connector-zendesk@0.28.1

## 0.28.0

### Patch Changes

- 663be46: Add `@rawdash/connector-clickup`, a new connector that syncs ClickUp spaces, folders, lists, and tasks (with status, priority, assignees, tags, and lifecycle timestamps) plus derived task lifecycle events (created / closed) from a ClickUp workspace. Authenticated via a ClickUp personal API token. Drives open-work stats, created/closed throughput timeseries, and status / list distributions.
- 8a27d2f: Add `@rawdash/connector-shopify` — syncs orders, customers, and products as entities plus a derived refund event per order from the Shopify Admin GraphQL API. Authenticates with a Custom App Admin API access token scoped to a `myshopify.com` store domain, supports a `resources` allowlist, and runs backfill plus `updated_at`-based incremental sync.
- Updated dependencies [663be46]
- Updated dependencies [0e4102e]
- Updated dependencies [0e4102e]
- Updated dependencies [4afcf27]
- Updated dependencies [0e4102e]
- Updated dependencies [880a584]
- Updated dependencies [0e4102e]
- Updated dependencies [9b7e1ef]
- Updated dependencies [32e45f3]
- Updated dependencies [ce259d5]
- Updated dependencies [3c0f059]
- Updated dependencies [0e4102e]
- Updated dependencies [0e4102e]
- Updated dependencies [0e4102e]
- Updated dependencies [204204a]
- Updated dependencies [0e4102e]
- Updated dependencies [0e4102e]
- Updated dependencies [6ca0ebf]
- Updated dependencies [6a1ccc1]
- Updated dependencies [ea5dd52]
- Updated dependencies [8a27d2f]
- Updated dependencies [6131298]
  - @rawdash/connector-clickup@0.28.0
  - @rawdash/connector-anthropic@0.28.0
  - @rawdash/connector-appsflyer@0.28.0
  - @rawdash/connector-asana@0.28.0
  - @rawdash/connector-branch@0.28.0
  - @rawdash/connector-monday@0.28.0
  - @rawdash/core@0.28.0
  - @rawdash/connector-github@0.28.0
  - @rawdash/connector-gitlab@0.28.0
  - @rawdash/connector-hubspot@0.28.0
  - @rawdash/connector-jira@0.28.0
  - @rawdash/connector-langfuse@0.28.0
  - @rawdash/connector-langsmith@0.28.0
  - @rawdash/connector-meta-ads@0.28.0
  - @rawdash/connector-openai@0.28.0
  - @rawdash/connector-posthog@0.28.0
  - @rawdash/connector-salesforce@0.28.0
  - @rawdash/connector-shopify@0.28.0
  - @rawdash/connector-stripe@0.28.0
  - @rawdash/connector-app-store-connect@0.28.0
  - @rawdash/connector-auth0@0.28.0
  - @rawdash/connector-aws-bedrock@0.28.0
  - @rawdash/connector-aws-cloudwatch@0.28.0
  - @rawdash/connector-aws-cost@0.28.0
  - @rawdash/connector-azure-cost@0.28.0
  - @rawdash/connector-azure-monitor@0.28.0
  - @rawdash/connector-bitbucket@0.28.0
  - @rawdash/connector-circleci@0.28.0
  - @rawdash/connector-clerk@0.28.0
  - @rawdash/connector-datadog@0.28.0
  - @rawdash/connector-drata@0.28.0
  - @rawdash/connector-entra-id@0.28.0
  - @rawdash/connector-firebase-analytics@0.28.0
  - @rawdash/connector-firebase-crashlytics@0.28.0
  - @rawdash/connector-gcp-billing@0.28.0
  - @rawdash/connector-gcp-monitoring@0.28.0
  - @rawdash/connector-google-ads@0.28.0
  - @rawdash/connector-google-analytics@0.28.0
  - @rawdash/connector-google-play-console@0.28.0
  - @rawdash/connector-google-search-console@0.28.0
  - @rawdash/connector-greenhouse@0.28.0
  - @rawdash/connector-intercom@0.28.0
  - @rawdash/connector-klaviyo@0.28.0
  - @rawdash/connector-launchdarkly@0.28.0
  - @rawdash/connector-linear@0.28.0
  - @rawdash/connector-mailchimp@0.28.0
  - @rawdash/connector-mixpanel@0.28.0
  - @rawdash/connector-netlify@0.28.0
  - @rawdash/connector-new-relic@0.28.0
  - @rawdash/connector-okta@0.28.0
  - @rawdash/connector-revenuecat@0.28.0
  - @rawdash/connector-sentry@0.28.0
  - @rawdash/connector-statuspage@0.28.0
  - @rawdash/connector-vanta@0.28.0
  - @rawdash/connector-vercel@0.28.0
  - @rawdash/connector-vertex-ai@0.28.0
  - @rawdash/connector-wiz@0.28.0
  - @rawdash/connector-workos@0.28.0
  - @rawdash/connector-zendesk@0.28.0

## 0.27.0

### Patch Changes

- ebacf62: Add `@rawdash/connector-vanta`. Syncs controls, tests, and test findings from a Vanta workspace via the Public API (`/v1/controls`, `/v1/tests`, `/v1/test-findings`) for compliance dashboards (audit-ready %, failing-test counts, open finding counts and severity breakdowns). OAuth 2.0 client-credentials auth (default `vanta-api.all:read` scope), cursor pagination, configurable findings lookback window, and full + incremental sync modes.
- 7cb0b72: Add `@rawdash/connector-workos`. Syncs WorkOS organizations, SSO connections, directory-sync directories, and authentication events (SSO/OAuth/password/magic-auth/MFA succeeded and failed) into the six-shape storage model. Bearer-token auth via a WorkOS API key, cursor pagination via `list_metadata.after`, and `range_start` push-down for the Events API so incremental syncs only fetch events newer than the watermark.
- Updated dependencies [16446f4]
- Updated dependencies [810161f]
- Updated dependencies [f789d7b]
- Updated dependencies [828462c]
- Updated dependencies [12e4144]
- Updated dependencies [3c75312]
- Updated dependencies [75021e9]
- Updated dependencies [ebacf62]
- Updated dependencies [7cb0b72]
  - @rawdash/connector-wiz@0.27.0
  - @rawdash/connector-clerk@0.27.0
  - @rawdash/connector-drata@0.27.0
  - @rawdash/connector-entra-id@0.27.0
  - @rawdash/connector-sentry@0.27.0
  - @rawdash/connector-vanta@0.27.0
  - @rawdash/connector-workos@0.27.0
  - @rawdash/core@0.27.0
  - @rawdash/connector-anthropic@0.27.0
  - @rawdash/connector-auth0@0.27.0
  - @rawdash/connector-app-store-connect@0.27.0
  - @rawdash/connector-appsflyer@0.27.0
  - @rawdash/connector-aws-bedrock@0.27.0
  - @rawdash/connector-aws-cloudwatch@0.27.0
  - @rawdash/connector-azure-cost@0.27.0
  - @rawdash/connector-azure-monitor@0.27.0
  - @rawdash/connector-datadog@0.27.0
  - @rawdash/connector-firebase-crashlytics@0.27.0
  - @rawdash/connector-github@0.27.0
  - @rawdash/connector-bitbucket@0.27.0
  - @rawdash/connector-gitlab@0.27.0
  - @rawdash/connector-google-ads@0.27.0
  - @rawdash/connector-google-analytics@0.27.0
  - @rawdash/connector-google-play-console@0.27.0
  - @rawdash/connector-google-search-console@0.27.0
  - @rawdash/connector-greenhouse@0.27.0
  - @rawdash/connector-stripe@0.27.0
  - @rawdash/connector-linear@0.27.0
  - @rawdash/connector-vercel@0.27.0
  - @rawdash/connector-aws-cost@0.27.0
  - @rawdash/connector-circleci@0.27.0
  - @rawdash/connector-gcp-billing@0.27.0
  - @rawdash/connector-gcp-monitoring@0.27.0
  - @rawdash/connector-hubspot@0.27.0
  - @rawdash/connector-intercom@0.27.0
  - @rawdash/connector-jira@0.27.0
  - @rawdash/connector-launchdarkly@0.27.0
  - @rawdash/connector-klaviyo@0.27.0
  - @rawdash/connector-mailchimp@0.27.0
  - @rawdash/connector-meta-ads@0.27.0
  - @rawdash/connector-mixpanel@0.27.0
  - @rawdash/connector-netlify@0.27.0
  - @rawdash/connector-posthog@0.27.0
  - @rawdash/connector-salesforce@0.27.0
  - @rawdash/connector-new-relic@0.27.0
  - @rawdash/connector-zendesk@0.27.0
  - @rawdash/connector-statuspage@0.27.0
  - @rawdash/connector-revenuecat@0.27.0
  - @rawdash/connector-firebase-analytics@0.27.0
  - @rawdash/connector-openai@0.27.0
  - @rawdash/connector-langfuse@0.27.0
  - @rawdash/connector-branch@0.27.0
  - @rawdash/connector-vertex-ai@0.27.0
  - @rawdash/connector-okta@0.27.0
  - @rawdash/connector-langsmith@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [4f88b52]
- Updated dependencies [8f64e77]
- Updated dependencies [c0ee2bf]
- Updated dependencies [be37afe]
- Updated dependencies [d088f65]
- Updated dependencies [8bb1b2a]
- Updated dependencies [3e3524f]
  - @rawdash/connector-azure-cost@0.26.0
  - @rawdash/connector-azure-monitor@0.26.0
  - @rawdash/connector-bitbucket@0.26.0
  - @rawdash/connector-branch@0.26.0
  - @rawdash/connector-circleci@0.26.0
  - @rawdash/connector-datadog@0.26.0
  - @rawdash/connector-sentry@0.26.0
  - @rawdash/core@0.26.0
  - @rawdash/connector-anthropic@0.26.0
  - @rawdash/connector-auth0@0.26.0
  - @rawdash/connector-app-store-connect@0.26.0
  - @rawdash/connector-appsflyer@0.26.0
  - @rawdash/connector-aws-bedrock@0.26.0
  - @rawdash/connector-aws-cloudwatch@0.26.0
  - @rawdash/connector-firebase-crashlytics@0.26.0
  - @rawdash/connector-github@0.26.0
  - @rawdash/connector-gitlab@0.26.0
  - @rawdash/connector-google-ads@0.26.0
  - @rawdash/connector-google-analytics@0.26.0
  - @rawdash/connector-google-play-console@0.26.0
  - @rawdash/connector-google-search-console@0.26.0
  - @rawdash/connector-greenhouse@0.26.0
  - @rawdash/connector-stripe@0.26.0
  - @rawdash/connector-linear@0.26.0
  - @rawdash/connector-vercel@0.26.0
  - @rawdash/connector-aws-cost@0.26.0
  - @rawdash/connector-gcp-billing@0.26.0
  - @rawdash/connector-gcp-monitoring@0.26.0
  - @rawdash/connector-hubspot@0.26.0
  - @rawdash/connector-intercom@0.26.0
  - @rawdash/connector-jira@0.26.0
  - @rawdash/connector-launchdarkly@0.26.0
  - @rawdash/connector-klaviyo@0.26.0
  - @rawdash/connector-mailchimp@0.26.0
  - @rawdash/connector-meta-ads@0.26.0
  - @rawdash/connector-mixpanel@0.26.0
  - @rawdash/connector-netlify@0.26.0
  - @rawdash/connector-posthog@0.26.0
  - @rawdash/connector-salesforce@0.26.0
  - @rawdash/connector-new-relic@0.26.0
  - @rawdash/connector-zendesk@0.26.0
  - @rawdash/connector-statuspage@0.26.0
  - @rawdash/connector-revenuecat@0.26.0
  - @rawdash/connector-firebase-analytics@0.26.0
  - @rawdash/connector-openai@0.26.0
  - @rawdash/connector-langfuse@0.26.0
  - @rawdash/connector-vertex-ai@0.26.0
  - @rawdash/connector-okta@0.26.0
  - @rawdash/connector-langsmith@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [d370656]
- Updated dependencies [faade33]
- Updated dependencies [cc4eeaa]
- Updated dependencies [608d014]
- Updated dependencies [8315556]
- Updated dependencies [bf76511]
- Updated dependencies [52ec2cc]
- Updated dependencies [1e1dc00]
- Updated dependencies [4b3f3df]
- Updated dependencies [5848686]
- Updated dependencies [7e2fc9d]
- Updated dependencies [162a6dc]
- Updated dependencies [f81452a]
- Updated dependencies [c0412a1]
- Updated dependencies [f99cb16]
  - @rawdash/connector-anthropic@0.25.0
  - @rawdash/connector-app-store-connect@0.25.0
  - @rawdash/connector-appsflyer@0.25.0
  - @rawdash/connector-auth0@0.25.0
  - @rawdash/connector-aws-bedrock@0.25.0
  - @rawdash/connector-aws-cloudwatch@0.25.0
  - @rawdash/connector-aws-cost@0.25.0
  - @rawdash/connector-github@0.25.0
  - @rawdash/connector-google-play-console@0.25.0
  - @rawdash/connector-linear@0.25.0
  - @rawdash/connector-sentry@0.25.0
  - @rawdash/connector-posthog@0.25.0
  - @rawdash/core@0.25.0
  - @rawdash/connector-azure-cost@0.25.0
  - @rawdash/connector-azure-monitor@0.25.0
  - @rawdash/connector-bitbucket@0.25.0
  - @rawdash/connector-branch@0.25.0
  - @rawdash/connector-circleci@0.25.0
  - @rawdash/connector-datadog@0.25.0
  - @rawdash/connector-firebase-analytics@0.25.0
  - @rawdash/connector-firebase-crashlytics@0.25.0
  - @rawdash/connector-gcp-billing@0.25.0
  - @rawdash/connector-gcp-monitoring@0.25.0
  - @rawdash/connector-gitlab@0.25.0
  - @rawdash/connector-google-ads@0.25.0
  - @rawdash/connector-google-analytics@0.25.0
  - @rawdash/connector-google-search-console@0.25.0
  - @rawdash/connector-greenhouse@0.25.0
  - @rawdash/connector-hubspot@0.25.0
  - @rawdash/connector-intercom@0.25.0
  - @rawdash/connector-jira@0.25.0
  - @rawdash/connector-klaviyo@0.25.0
  - @rawdash/connector-langfuse@0.25.0
  - @rawdash/connector-langsmith@0.25.0
  - @rawdash/connector-launchdarkly@0.25.0
  - @rawdash/connector-mailchimp@0.25.0
  - @rawdash/connector-meta-ads@0.25.0
  - @rawdash/connector-mixpanel@0.25.0
  - @rawdash/connector-netlify@0.25.0
  - @rawdash/connector-new-relic@0.25.0
  - @rawdash/connector-okta@0.25.0
  - @rawdash/connector-openai@0.25.0
  - @rawdash/connector-revenuecat@0.25.0
  - @rawdash/connector-salesforce@0.25.0
  - @rawdash/connector-statuspage@0.25.0
  - @rawdash/connector-stripe@0.25.0
  - @rawdash/connector-vercel@0.25.0
  - @rawdash/connector-vertex-ai@0.25.0
  - @rawdash/connector-zendesk@0.25.0

## 0.24.0

### Patch Changes

- 5f33f22: Add `@rawdash/connector-langsmith` covering LangSmith runs (entity), per-run
  samples surfaced as `langsmith_runs_per_day` (token / cost / latency attributes
  so widgets aggregate by day or project at query time), and feedback scores.
  Auth via `x-api-key`; endpoint defaults to US cloud and is configurable to EU
  or self-hosted origins.
- efc8fc0: Add `@rawdash/connector-okta`. Syncs users, groups, and authentication events from an Okta org via the Management API (`/api/v1/users`, `/api/v1/groups`) and System Log (`/api/v1/logs`). SSWS API-token auth, configurable org host, Link-header pagination, incremental SCIM `lastUpdated gt` filtering on entity resources, and native `since` on the System Log; honors Okta's `X-Rate-Limit-*` headers via the shared rate-limit policy.
- Updated dependencies [38fde14]
- Updated dependencies [5c07c18]
- Updated dependencies [5f33f22]
- Updated dependencies [efc8fc0]
- Updated dependencies [fe1ee4b]
- Updated dependencies [ad70083]
  - @rawdash/connector-auth0@0.24.0
  - @rawdash/connector-github@0.24.0
  - @rawdash/connector-langsmith@0.24.0
  - @rawdash/connector-okta@0.24.0
  - @rawdash/core@0.24.0
  - @rawdash/connector-google-ads@0.24.0
  - @rawdash/connector-meta-ads@0.24.0
  - @rawdash/connector-anthropic@0.24.0
  - @rawdash/connector-app-store-connect@0.24.0
  - @rawdash/connector-appsflyer@0.24.0
  - @rawdash/connector-aws-bedrock@0.24.0
  - @rawdash/connector-aws-cloudwatch@0.24.0
  - @rawdash/connector-aws-cost@0.24.0
  - @rawdash/connector-azure-cost@0.24.0
  - @rawdash/connector-azure-monitor@0.24.0
  - @rawdash/connector-bitbucket@0.24.0
  - @rawdash/connector-branch@0.24.0
  - @rawdash/connector-circleci@0.24.0
  - @rawdash/connector-datadog@0.24.0
  - @rawdash/connector-firebase-analytics@0.24.0
  - @rawdash/connector-firebase-crashlytics@0.24.0
  - @rawdash/connector-gcp-billing@0.24.0
  - @rawdash/connector-gcp-monitoring@0.24.0
  - @rawdash/connector-gitlab@0.24.0
  - @rawdash/connector-google-analytics@0.24.0
  - @rawdash/connector-google-play-console@0.24.0
  - @rawdash/connector-google-search-console@0.24.0
  - @rawdash/connector-greenhouse@0.24.0
  - @rawdash/connector-hubspot@0.24.0
  - @rawdash/connector-intercom@0.24.0
  - @rawdash/connector-jira@0.24.0
  - @rawdash/connector-klaviyo@0.24.0
  - @rawdash/connector-langfuse@0.24.0
  - @rawdash/connector-launchdarkly@0.24.0
  - @rawdash/connector-linear@0.24.0
  - @rawdash/connector-mailchimp@0.24.0
  - @rawdash/connector-mixpanel@0.24.0
  - @rawdash/connector-netlify@0.24.0
  - @rawdash/connector-new-relic@0.24.0
  - @rawdash/connector-openai@0.24.0
  - @rawdash/connector-posthog@0.24.0
  - @rawdash/connector-revenuecat@0.24.0
  - @rawdash/connector-salesforce@0.24.0
  - @rawdash/connector-sentry@0.24.0
  - @rawdash/connector-statuspage@0.24.0
  - @rawdash/connector-stripe@0.24.0
  - @rawdash/connector-vercel@0.24.0
  - @rawdash/connector-vertex-ai@0.24.0
  - @rawdash/connector-zendesk@0.24.0

## 0.23.0

### Patch Changes

- 125f6f8: Add `@rawdash/connector-branch`, a new connector that syncs daily Branch attribution metrics (installs, opens, conversions, and estimated cost by channel and campaign) and aggregated deep-link click events (by channel, campaign, feature) from the Branch Cross-Platform Analytics API. Authenticated via Branch app key + secret.
- 70d0c0f: Add `@rawdash/connector-openai`, a new connector that syncs the OpenAI organization Usage and Costs admin APIs into twelve daily metric series: completions input / output tokens + requests, embeddings input tokens + requests, images count + requests, audio_speeches characters + requests, audio_transcriptions seconds + requests, and cost in USD. Authenticates with an OpenAI admin API key (sk-admin-) and supports optional organization and project-id scoping; lookback window defaults to 30 days (capped at 180).
- Updated dependencies [9acb935]
- Updated dependencies [125f6f8]
- Updated dependencies [a4b89c4]
- Updated dependencies [70d0c0f]
- Updated dependencies [289f42e]
- Updated dependencies [e6d5f18]
- Updated dependencies [2816c8a]
- Updated dependencies [f7346f2]
- Updated dependencies [8bce1e2]
- Updated dependencies [1159dc1]
- Updated dependencies [7768223]
  - @rawdash/connector-aws-bedrock@0.23.0
  - @rawdash/connector-branch@0.23.0
  - @rawdash/connector-langfuse@0.23.0
  - @rawdash/connector-openai@0.23.0
  - @rawdash/connector-anthropic@0.23.0
  - @rawdash/core@0.23.0
  - @rawdash/connector-stripe@0.23.0
  - @rawdash/connector-vertex-ai@0.23.0
  - @rawdash/connector-app-store-connect@0.23.0
  - @rawdash/connector-appsflyer@0.23.0
  - @rawdash/connector-aws-cloudwatch@0.23.0
  - @rawdash/connector-aws-cost@0.23.0
  - @rawdash/connector-azure-cost@0.23.0
  - @rawdash/connector-azure-monitor@0.23.0
  - @rawdash/connector-bitbucket@0.23.0
  - @rawdash/connector-circleci@0.23.0
  - @rawdash/connector-datadog@0.23.0
  - @rawdash/connector-firebase-analytics@0.23.0
  - @rawdash/connector-firebase-crashlytics@0.23.0
  - @rawdash/connector-gcp-billing@0.23.0
  - @rawdash/connector-gcp-monitoring@0.23.0
  - @rawdash/connector-github@0.23.0
  - @rawdash/connector-gitlab@0.23.0
  - @rawdash/connector-google-ads@0.23.0
  - @rawdash/connector-google-analytics@0.23.0
  - @rawdash/connector-google-play-console@0.23.0
  - @rawdash/connector-google-search-console@0.23.0
  - @rawdash/connector-greenhouse@0.23.0
  - @rawdash/connector-hubspot@0.23.0
  - @rawdash/connector-intercom@0.23.0
  - @rawdash/connector-jira@0.23.0
  - @rawdash/connector-klaviyo@0.23.0
  - @rawdash/connector-launchdarkly@0.23.0
  - @rawdash/connector-linear@0.23.0
  - @rawdash/connector-mailchimp@0.23.0
  - @rawdash/connector-meta-ads@0.23.0
  - @rawdash/connector-mixpanel@0.23.0
  - @rawdash/connector-netlify@0.23.0
  - @rawdash/connector-new-relic@0.23.0
  - @rawdash/connector-posthog@0.23.0
  - @rawdash/connector-revenuecat@0.23.0
  - @rawdash/connector-salesforce@0.23.0
  - @rawdash/connector-sentry@0.23.0
  - @rawdash/connector-statuspage@0.23.0
  - @rawdash/connector-vercel@0.23.0
  - @rawdash/connector-zendesk@0.23.0

## 0.22.0

### Minor Changes

- 851d1f1: Add `@rawdash/connector-app-store-connect` — syncs the team's iOS/macOS apps, daily sales (units and developer proceeds), and a rolling sample of customer review ratings from the App Store Connect REST API into the six-shape storage model. Authenticates with an ES256-signed JWT minted per request from an issuer ID, key ID, and a PKCS#8 EC private key (.p8). Sales reports are fetched as gzipped TSV (DAILY frequency, SALES SUMMARY) and broken out by `(date, app, country, productTypeIdentifier)`; revenue samples preserve each row's native "Currency of Proceeds" so downstream widgets can group or FX-convert. App ratings are sampled from each app's most-recent N customer reviews (default 200, capped at 2,000) and emitted as a metric with rating 1-5 as the value and territory on the attribute, since Apple does not expose lifetime aggregates over the REST API. Per-build crash counts (`app_crashes`) are intentionally deferred — they require the asynchronous Analytics Reports request/poll/download flow which is a follow-up. A new `mobile` connector category is added to `@rawdash/core` so this and future mobile connectors land in a dedicated docs vertical.

### Patch Changes

- a190bd9: Add `@rawdash/connector-appsflyer`, a new connector that syncs daily install metrics (installs, cost, revenue, conversions by media source and campaign) and cohort retention (retention day 1/7/30 by media source) from the AppsFlyer Master API. Authenticated via a V2.0 bearer API token.
- 0b6099b: New connector `@rawdash/connector-firebase-analytics` that syncs a Firebase project's analytics data through the linked GA4 Data API. Three metric resources: `firebase_dau_wau_mau` (DAU/WAU/MAU per day), `firebase_events_per_day` (per-event counts and active users), and `firebase_retention` (active users by `firstSessionDate` x `date` with a derived `period` attribute for cohort retention). Auth mirrors `@rawdash/connector-google-analytics` (service-account JWT or OAuth refresh-token tuple) and a required `firebaseAppId` labels every sample with the source app. Backfill (90-day default) and incremental (30-day rolling) syncs both honor `options.since` and `options.resources`, with a resumable phase cursor.
- 41d4d01: Add `@rawdash/connector-revenuecat`, a new connector for the RevenueCat v2 REST API. Syncs products, entitlements, customers, and subscription entities (extracted from each customer's embedded `subscriptions.items` field) plus subscription lifecycle events, and writes a point-in-time snapshot of the project's overview metrics (MRR, active subscriptions, trial conversion rate, ...) on every sync. Authenticates with a project-scoped v2 API key and supports both full backfills and `since`-driven incremental event syncs.
- Updated dependencies [a190bd9]
- Updated dependencies [4d15cfd]
- Updated dependencies [833af29]
- Updated dependencies [851d1f1]
- Updated dependencies [beb78ff]
- Updated dependencies [0b6099b]
- Updated dependencies [4e7c58e]
- Updated dependencies [0b6099b]
- Updated dependencies [47aefb7]
- Updated dependencies [41d4d01]
- Updated dependencies [e47003f]
- Updated dependencies [80eccb6]
- Updated dependencies [d224059]
- Updated dependencies [c3d227f]
- Updated dependencies [afbf954]
  - @rawdash/connector-appsflyer@0.22.0
  - @rawdash/connector-firebase-crashlytics@0.22.0
  - @rawdash/connector-bitbucket@0.22.0
  - @rawdash/connector-app-store-connect@0.22.0
  - @rawdash/core@0.22.0
  - @rawdash/connector-aws-cloudwatch@0.22.0
  - @rawdash/connector-aws-cost@0.22.0
  - @rawdash/connector-azure-cost@0.22.0
  - @rawdash/connector-azure-monitor@0.22.0
  - @rawdash/connector-circleci@0.22.0
  - @rawdash/connector-datadog@0.22.0
  - @rawdash/connector-gcp-billing@0.22.0
  - @rawdash/connector-gcp-monitoring@0.22.0
  - @rawdash/connector-github@0.22.0
  - @rawdash/connector-gitlab@0.22.0
  - @rawdash/connector-google-ads@0.22.0
  - @rawdash/connector-google-analytics@0.22.0
  - @rawdash/connector-google-search-console@0.22.0
  - @rawdash/connector-greenhouse@0.22.0
  - @rawdash/connector-hubspot@0.22.0
  - @rawdash/connector-intercom@0.22.0
  - @rawdash/connector-jira@0.22.0
  - @rawdash/connector-klaviyo@0.22.0
  - @rawdash/connector-launchdarkly@0.22.0
  - @rawdash/connector-linear@0.22.0
  - @rawdash/connector-mailchimp@0.22.0
  - @rawdash/connector-meta-ads@0.22.0
  - @rawdash/connector-mixpanel@0.22.0
  - @rawdash/connector-netlify@0.22.0
  - @rawdash/connector-new-relic@0.22.0
  - @rawdash/connector-posthog@0.22.0
  - @rawdash/connector-salesforce@0.22.0
  - @rawdash/connector-sentry@0.22.0
  - @rawdash/connector-statuspage@0.22.0
  - @rawdash/connector-stripe@0.22.0
  - @rawdash/connector-vercel@0.22.0
  - @rawdash/connector-zendesk@0.22.0
  - @rawdash/connector-firebase-analytics@0.22.0
  - @rawdash/connector-google-play-console@0.22.0
  - @rawdash/connector-revenuecat@0.22.0

## 0.21.1

### Patch Changes

- Updated dependencies [0ea575d]
  - @rawdash/connector-github@0.21.1
  - @rawdash/core@0.21.1
  - @rawdash/connector-aws-cloudwatch@0.21.1
  - @rawdash/connector-azure-cost@0.21.1
  - @rawdash/connector-azure-monitor@0.21.1
  - @rawdash/connector-datadog@0.21.1
  - @rawdash/connector-bitbucket@0.21.1
  - @rawdash/connector-gitlab@0.21.1
  - @rawdash/connector-google-ads@0.21.1
  - @rawdash/connector-google-analytics@0.21.1
  - @rawdash/connector-google-search-console@0.21.1
  - @rawdash/connector-greenhouse@0.21.1
  - @rawdash/connector-stripe@0.21.1
  - @rawdash/connector-linear@0.21.1
  - @rawdash/connector-sentry@0.21.1
  - @rawdash/connector-vercel@0.21.1
  - @rawdash/connector-aws-cost@0.21.1
  - @rawdash/connector-circleci@0.21.1
  - @rawdash/connector-gcp-billing@0.21.1
  - @rawdash/connector-gcp-monitoring@0.21.1
  - @rawdash/connector-hubspot@0.21.1
  - @rawdash/connector-intercom@0.21.1
  - @rawdash/connector-jira@0.21.1
  - @rawdash/connector-launchdarkly@0.21.1
  - @rawdash/connector-klaviyo@0.21.1
  - @rawdash/connector-mailchimp@0.21.1
  - @rawdash/connector-meta-ads@0.21.1
  - @rawdash/connector-mixpanel@0.21.1
  - @rawdash/connector-netlify@0.21.1
  - @rawdash/connector-posthog@0.21.1
  - @rawdash/connector-salesforce@0.21.1
  - @rawdash/connector-new-relic@0.21.1
  - @rawdash/connector-zendesk@0.21.1
  - @rawdash/connector-statuspage@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [c796c09]
- Updated dependencies [37f1083]
- Updated dependencies [32d0d2c]
  - @rawdash/core@0.21.0
  - @rawdash/connector-github@0.21.0
  - @rawdash/connector-netlify@0.21.0
  - @rawdash/connector-aws-cloudwatch@0.21.0
  - @rawdash/connector-aws-cost@0.21.0
  - @rawdash/connector-azure-cost@0.21.0
  - @rawdash/connector-azure-monitor@0.21.0
  - @rawdash/connector-bitbucket@0.21.0
  - @rawdash/connector-circleci@0.21.0
  - @rawdash/connector-datadog@0.21.0
  - @rawdash/connector-gcp-billing@0.21.0
  - @rawdash/connector-gcp-monitoring@0.21.0
  - @rawdash/connector-gitlab@0.21.0
  - @rawdash/connector-google-ads@0.21.0
  - @rawdash/connector-google-analytics@0.21.0
  - @rawdash/connector-google-search-console@0.21.0
  - @rawdash/connector-greenhouse@0.21.0
  - @rawdash/connector-hubspot@0.21.0
  - @rawdash/connector-intercom@0.21.0
  - @rawdash/connector-jira@0.21.0
  - @rawdash/connector-klaviyo@0.21.0
  - @rawdash/connector-launchdarkly@0.21.0
  - @rawdash/connector-linear@0.21.0
  - @rawdash/connector-mailchimp@0.21.0
  - @rawdash/connector-meta-ads@0.21.0
  - @rawdash/connector-mixpanel@0.21.0
  - @rawdash/connector-new-relic@0.21.0
  - @rawdash/connector-posthog@0.21.0
  - @rawdash/connector-salesforce@0.21.0
  - @rawdash/connector-sentry@0.21.0
  - @rawdash/connector-statuspage@0.21.0
  - @rawdash/connector-stripe@0.21.0
  - @rawdash/connector-vercel@0.21.0
  - @rawdash/connector-zendesk@0.21.0

## 0.20.0

### Minor Changes

- 20c6db4: Add `@rawdash/connector-netlify` - syncs Netlify sites and deploys into the six-shape storage model: `netlify_site` and `netlify_deploy` as entities, plus `netlify_deploy_event` per deploy spanning created->published. Authenticates with a Netlify personal access token (Bearer). The deploys phase iterates each site (configured via `siteIds` or discovered from `GET /sites`), paginating per-site via the standard Link header. Netlify has no server-side date filter on the deploys endpoint, so `deploysLookbackDays` (when set) is applied client-side and short-circuits pagination once a full page is older than the cutoff.

### Patch Changes

- fc7e0d0: Remove non-essential code comments (section dividers, section labels, and explanatory comments) across the codebase. No behavior change; published output is unaffected.
- Updated dependencies [92e7f62]
- Updated dependencies [b7fbbdc]
- Updated dependencies [8a6c1e7]
- Updated dependencies [20c6db4]
- Updated dependencies [d4be1b2]
- Updated dependencies [055d978]
- Updated dependencies [66d2e20]
- Updated dependencies [ec274eb]
- Updated dependencies [66d2e20]
- Updated dependencies [66d2e20]
- Updated dependencies [66d2e20]
- Updated dependencies [4f0f30f]
- Updated dependencies [fc7e0d0]
- Updated dependencies [2c11cc2]
  - @rawdash/connector-azure-monitor@0.20.0
  - @rawdash/connector-azure-cost@0.20.0
  - @rawdash/connector-bitbucket@0.20.0
  - @rawdash/connector-klaviyo@0.20.0
  - @rawdash/connector-netlify@0.20.0
  - @rawdash/connector-statuspage@0.20.0
  - @rawdash/connector-greenhouse@0.20.0
  - @rawdash/core@0.20.0
  - @rawdash/connector-linear@0.20.0
  - @rawdash/connector-mailchimp@0.20.0
  - @rawdash/connector-posthog@0.20.0
  - @rawdash/connector-sentry@0.20.0
  - @rawdash/connector-gitlab@0.20.0
  - @rawdash/connector-aws-cloudwatch@0.20.0
  - @rawdash/connector-aws-cost@0.20.0
  - @rawdash/connector-circleci@0.20.0
  - @rawdash/connector-datadog@0.20.0
  - @rawdash/connector-gcp-billing@0.20.0
  - @rawdash/connector-gcp-monitoring@0.20.0
  - @rawdash/connector-google-ads@0.20.0
  - @rawdash/connector-google-analytics@0.20.0
  - @rawdash/connector-google-search-console@0.20.0
  - @rawdash/connector-hubspot@0.20.0
  - @rawdash/connector-intercom@0.20.0
  - @rawdash/connector-jira@0.20.0
  - @rawdash/connector-launchdarkly@0.20.0
  - @rawdash/connector-meta-ads@0.20.0
  - @rawdash/connector-mixpanel@0.20.0
  - @rawdash/connector-new-relic@0.20.0
  - @rawdash/connector-salesforce@0.20.0
  - @rawdash/connector-stripe@0.20.0
  - @rawdash/connector-vercel@0.20.0
  - @rawdash/connector-zendesk@0.20.0
  - @rawdash/connector-github@0.20.0

## 0.19.0

### Patch Changes

- 6ea1c21: Rename the internal package directory `packages/connectors-umbrella` to `packages/connectors-aggregate` and update the published `description` and `repository.directory` metadata accordingly. The package name (`@rawdash/connectors`) and all exports are unchanged, so this is a non-breaking, metadata-only change for consumers.
- Updated dependencies [895222d]
- Updated dependencies [33d5b1c]
- Updated dependencies [336dc03]
- Updated dependencies [725ebcc]
  - @rawdash/connector-circleci@0.19.0
  - @rawdash/connector-new-relic@0.19.0
  - @rawdash/connector-zendesk@0.19.0
  - @rawdash/core@0.19.0
  - @rawdash/connector-aws-cloudwatch@0.19.0
  - @rawdash/connector-aws-cost@0.19.0
  - @rawdash/connector-datadog@0.19.0
  - @rawdash/connector-gcp-billing@0.19.0
  - @rawdash/connector-gcp-monitoring@0.19.0
  - @rawdash/connector-github@0.19.0
  - @rawdash/connector-gitlab@0.19.0
  - @rawdash/connector-google-ads@0.19.0
  - @rawdash/connector-google-analytics@0.19.0
  - @rawdash/connector-google-search-console@0.19.0
  - @rawdash/connector-hubspot@0.19.0
  - @rawdash/connector-intercom@0.19.0
  - @rawdash/connector-jira@0.19.0
  - @rawdash/connector-launchdarkly@0.19.0
  - @rawdash/connector-linear@0.19.0
  - @rawdash/connector-meta-ads@0.19.0
  - @rawdash/connector-mixpanel@0.19.0
  - @rawdash/connector-posthog@0.19.0
  - @rawdash/connector-salesforce@0.19.0
  - @rawdash/connector-sentry@0.19.0
  - @rawdash/connector-stripe@0.19.0
  - @rawdash/connector-vercel@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [ed81ad7]
- Updated dependencies [825868d]
- Updated dependencies [f469ba3]
- Updated dependencies [621b32f]
- Updated dependencies [c33b2ef]
  - @rawdash/connector-gitlab@0.18.0
  - @rawdash/connector-gcp-monitoring@0.18.0
  - @rawdash/connector-gcp-billing@0.18.0
  - @rawdash/connector-launchdarkly@0.18.0
  - @rawdash/connector-github@0.18.0
  - @rawdash/core@0.18.0
  - @rawdash/connector-aws-cloudwatch@0.18.0
  - @rawdash/connector-datadog@0.18.0
  - @rawdash/connector-google-ads@0.18.0
  - @rawdash/connector-google-analytics@0.18.0
  - @rawdash/connector-google-search-console@0.18.0
  - @rawdash/connector-stripe@0.18.0
  - @rawdash/connector-linear@0.18.0
  - @rawdash/connector-sentry@0.18.0
  - @rawdash/connector-vercel@0.18.0
  - @rawdash/connector-aws-cost@0.18.0
  - @rawdash/connector-hubspot@0.18.0
  - @rawdash/connector-intercom@0.18.0
  - @rawdash/connector-jira@0.18.0
  - @rawdash/connector-meta-ads@0.18.0
  - @rawdash/connector-mixpanel@0.18.0
  - @rawdash/connector-posthog@0.18.0
  - @rawdash/connector-salesforce@0.18.0

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
