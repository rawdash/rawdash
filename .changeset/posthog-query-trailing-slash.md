---
'@rawdash/connector-posthog': patch
---

Fix the PostHog connector posting analytical queries (events per day, feature flag usage, active users, funnels) to `/api/projects/{projectId}/query` without a trailing slash. PostHog's query endpoint is `/api/projects/{projectId}/query/`; the non-slash path triggers a redirect that drops the POST body, leaving those four resources without data. Queries now target the trailing-slash endpoint.
