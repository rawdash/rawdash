---
'@rawdash/connector-clerk': minor
---

Ground the Clerk connector in the Backend API.

- `GET /v1/organizations` omits `members_count` unless `include_members_count=true` is requested, so `clerk_organization.membersCount` was persisted as `null` for every organization on every sync. The flag is now sent.
- `clerk_daily_active_users` bucketed users across a configurable lookback window by `last_active_at`, which holds only each user's most recent activity — so every past day's value was revised downward on each sync — and the write was an unscoped replace-by-name that deleted every sample older than the window. The metric now records one sample for the current UTC day, scoped with `replaceWindow` to that day so earlier samples survive, and the now-meaningless `dauLookbackDays` config field is removed.
- `pending` is part of the Backend API's session status enum but was missing from the connector's set, and unrecognised statuses were coerced to `active`. Session status is now stored as returned.
- The users and daily-active-users phases ordered offset-paginated requests by `-last_active_at`, a field Clerk updates on session activity, so rows shifted between pages mid-sync and were skipped. Both now order by the immutable `-created_at`.
- Per-sync `options.resources` was ignored, so a sync scoped to one resource still cleared and refetched the others. Phases are now gated by resource name.
- Incremental user syncs send `last_active_at_after` instead of the vendor-deprecated `last_active_at_since`.
- Corrected the documented Backend API rate limits.
