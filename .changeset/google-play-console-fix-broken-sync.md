---
'@rawdash/connector-google-play-console': minor
---

Fix the Google Play Console connector so it can run against the live Play Developer Reporting and Android Publisher APIs (previously every sync aborted; tests passed only because the APIs were mocked).

- **Breaking:** remove the `gplay_ratings_by_day` resource and its `ratings` phase. The Play Developer Reporting API has no `ratingsMetricSet` — the query errored and was rethrown, aborting every sync. A reviews-based rating is a separate follow-up.
- DAILY metric queries now send `timeZone: { id: 'America/Los_Angeles' }` and the date window is computed in that zone. UTC is only valid for HOURLY aggregation, so the previous UTC window was rejected or silently skewed. The `date` dimension descriptions are relabeled accordingly.
- Drop the `apps` listings fetch: `GET /androidpublisher/v3/applications/{packageName}/listings` does not exist (listings live only under an edit), so it always 404'd and the title was never populated. The `apps` entity now carries only `package_name`, and the unused `androidpublisher` OAuth scope is removed.
- Honor `options.resources` via `selectActivePhases`, so a scoped sync no longer queries every metric set.
- Add a `gplay_app_ratings` metric sourced from the Android Publisher reviews API. It is a rolling sample of recent reviews (configurable via the new `reviewLimit` setting, default 200); each sample carries one review's star rating (1-5) as the value. This replaces the removed `ratingsMetricSet` query — Google exposes ratings only as individual reviews, not as a daily average. The `androidpublisher` OAuth scope is restored for this.
