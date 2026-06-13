# @rawdash/connectors

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
