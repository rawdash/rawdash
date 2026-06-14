---
'@rawdash/connector-workos': patch
'@rawdash/connectors': patch
---

Add `@rawdash/connector-workos`. Syncs WorkOS organizations, SSO connections, directory-sync directories, and authentication events (SSO/OAuth/password/magic-auth/MFA succeeded and failed) into the six-shape storage model. Bearer-token auth via a WorkOS API key, cursor pagination via `list_metadata.after`, and `range_start` push-down for the Events API so incremental syncs only fetch events newer than the watermark.
