---
'@rawdash/connector-clerk': minor
---

Add `@rawdash/connector-clerk` — syncs users, organizations, sessions, and a derived daily-active-users metric from the Clerk Backend API. Authenticates with a Bearer secret key, supports a `resources` allowlist, and exposes a `dauLookbackDays` knob (1–90, default 30) for the DAU metric window.
