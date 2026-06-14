---
'@rawdash/connector-bitbucket': minor
---

Migrate Bitbucket authentication to Atlassian API tokens and fix the pull request `state` filter.

Breaking config change: the `appPassword` credential is renamed to `apiToken` and the `username` config field is renamed to `email`. Authentication now uses HTTP Basic auth with the Atlassian account email as the username and an Atlassian API token as the password. Update your config to set `email` and `apiToken` (create a token at https://id.atlassian.com/manage-profile/security/api-tokens).

The pull request query now sends repeated `state` parameters (`state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED`) as required by the Bitbucket Cloud REST API, instead of a single comma-joined value that matched no enum member.
