---
'@rawdash/connector-google-search-console': minor
---

Add `@rawdash/connector-google-search-console` - syncs Google Search Console SEO metrics (clicks, impressions, CTR, average position) for a verified URL-prefix or sc-domain property. Resources cover daily totals plus per-query, per-page, and per-country breakdowns. Authentication supports both a Google service account JSON key and an OAuth 2.0 refresh-token tuple with the `webmasters.readonly` scope. Backfill defaults to a trailing 90 days; incremental syncs refetch the trailing 3 days to absorb Search Console's standard 2-3 day reporting lag.
