---
'@rawdash/connector-netlify': minor
'@rawdash/connectors': minor
---

Add `@rawdash/connector-netlify` - syncs Netlify sites and deploys into the six-shape storage model: `netlify_site` and `netlify_deploy` as entities, plus `netlify_deploy_event` per deploy spanning created->published. Authenticates with a Netlify personal access token (Bearer). The deploys phase iterates each site (configured via `siteIds` or discovered from `GET /sites`), paginating per-site via the standard Link header. Netlify has no server-side date filter on the deploys endpoint, so `deploysLookbackDays` (when set) is applied client-side and short-circuits pagination once a full page is older than the cutoff.
