---
'@rawdash/core': patch
'@rawdash/cli': patch
---

Bug fixes:

- `@rawdash/cli` `--version` now reports the real package version instead of `0.0.0` ([RAW-123](https://linear.app/rawdash/issue/RAW-123)).
- `apps/example-nextjs` widget proxy switched from `force-static` to `force-dynamic`, fixing the 500 returned on every widget request ([RAW-131](https://linear.app/rawdash/issue/RAW-131)).
- `rawdash deploy` now translates the OSS `defineConfig()` shape to the cloud's `POST /config` body shape, so deploys actually persist ([RAW-134](https://linear.app/rawdash/issue/RAW-134)).
- `BaseConnector` gains a default `serializeConfig()` implementation; custom connectors extending `BaseConnector` inherit it transparently.
