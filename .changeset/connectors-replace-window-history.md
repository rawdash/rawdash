---
'@rawdash/connector-anthropic': patch
'@rawdash/connector-appsflyer': patch
'@rawdash/connector-openai': patch
'@rawdash/connector-aws-bedrock': patch
'@rawdash/connector-aws-cloudwatch': patch
'@rawdash/connector-aws-cost': patch
'@rawdash/connector-azure-cost': patch
'@rawdash/connector-azure-monitor': patch
'@rawdash/connector-firebase-analytics': patch
'@rawdash/connector-firebase-crashlytics': patch
'@rawdash/connector-gcp-billing': patch
'@rawdash/connector-google-ads': patch
'@rawdash/connector-google-analytics': patch
'@rawdash/connector-google-play-console': patch
'@rawdash/connector-google-search-console': patch
'@rawdash/connector-mixpanel': patch
'@rawdash/connector-vertex-ai': patch
---

Fix metric history loss on incremental syncs. These connectors write historical, past-dated metric samples but re-pull only a short trailing window on incremental (`latest`) syncs, then replaced the whole metric by name — so each incremental sync wiped all previously retained history outside that short window, leaving empty time series and unstable aggregates. Each sales/usage/cost metric write is now scoped to the report window the sync actually fetched (`replaceWindow`), refreshing only those days/hours and preserving older retained samples. Same root cause and fix as the App Store Connect change.
