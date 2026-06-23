---
'@rawdash/connector-firebase-analytics': patch
'@rawdash/connector-firebase-crashlytics': patch
'@rawdash/connector-gcp-billing': patch
'@rawdash/connector-gcp-monitoring': patch
'@rawdash/connector-google-analytics': patch
'@rawdash/connector-google-search-console': patch
'@rawdash/connector-vertex-ai': patch
---

Fix every sync failing with `value.trim is not a function` when the service account key is stored as raw JSON. The secrets resolver auto-parses any secret value beginning with `{` into an object, so the shared `parseServiceAccountJson` helper (bundled into each GCP connector) received the already-parsed service account object rather than a string and crashed on `.trim()`. The shared helper now accepts an already-parsed object — validated with the same schema — in addition to a raw JSON string or base64-encoded JSON, and the `GcpAccessTokenProvider` credential contract is typed accordingly.
