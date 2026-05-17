---
'@rawdash/adapter-libsql': patch
'@rawdash/cli': patch
'@rawdash/client': patch
'@rawdash/connector-github': patch
'@rawdash/core': patch
'@rawdash/mcp': patch
'@rawdash/nextjs': patch
'@rawdash/server': patch
---

Republish packages with `workspace:*` deps rewritten to real semver ranges. The publish workflow regressed in #59 and was emitting `"workspace:*"` literally into published `package.json` files, breaking installs for external consumers. The script now uses `pnpm publish` (which packs through pnpm's workspace-aware path) instead of `npm publish` directly.
