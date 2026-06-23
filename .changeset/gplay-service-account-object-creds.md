---
'@rawdash/connector-google-play-console': patch
---

Fix every sync failing with `value.trim is not a function` when the service account key is stored as raw JSON. The secrets resolver auto-parses any secret value beginning with `{` into an object, so the connector received the already-parsed service account object rather than a string, and `parseServiceAccountJson` called `.trim()` on it. `parseServiceAccountJson` now accepts an already-parsed object in addition to a raw JSON string or base64-encoded JSON.
