---
'@rawdash/connector-vertex-ai': patch
---

Group Vertex AI monitoring series by the PublisherModel resource label, clamp the window to Cloud Monitoring's retention, and net credits out of spend.

`model_user_id` is a label of the `aiplatform.googleapis.com/PublisherModel` monitored resource, not a metric label on `model_invocation_count` / `token_count`. The connector grouped on `metric.labels.model_user_id`, so the cross-series reduction dropped it and every publisher model collapsed into one series with `modelId` persisted as `null`. It now groups by `resource.labels.model_user_id` and reads the value from the response's resource labels.

Cloud Monitoring retains these metrics for 6 weeks, but `lookbackDays` (up to 365) was passed straight through as the window-replace range, so a full sync deleted every previously ingested invocation, error and token sample older than 6 weeks and replaced it with nothing. The monitoring window — and its replace range — is now clamped to a 42-day retention floor, with a warning logged on truncation. The spend window still honours the full `lookbackDays`.

The spend query summed the gross `cost` column and ignored the repeated `credits` array, overstating spend for accounts with free-tier, promotional, committed-use or sustained-use discounts. It now nets credit amounts out of the aggregate.
