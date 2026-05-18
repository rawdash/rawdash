---
'@rawdash/connector-github': patch
---

Bundle the internal shared substrate (renamed from `@rawdash/http-client` to `@rawdash/connector-shared`) into the published tarball via tsup `noExternal`, so `npm i @rawdash/connector-github` resolves cleanly without a dangling workspace dependency.
