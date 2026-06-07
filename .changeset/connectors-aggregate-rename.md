---
'@rawdash/connectors': patch
---

Rename the internal package directory `packages/connectors-umbrella` to `packages/connectors-aggregate` and update the published `description` and `repository.directory` metadata accordingly. The package name (`@rawdash/connectors`) and all exports are unchanged, so this is a non-breaking, metadata-only change for consumers.
