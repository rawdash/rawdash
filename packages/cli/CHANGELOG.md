# @rawdash/cli

## 0.1.1

### Patch Changes

- 12f27e0: Bug fixes:
  - `@rawdash/cli` `--version` now reports the real package version instead of `0.0.0` ([RAW-123](https://linear.app/rawdash/issue/RAW-123)).
  - `rawdash deploy` now translates the OSS `defineConfig()` shape to the cloud's `POST /config` body shape, so deploys actually persist ([RAW-134](https://linear.app/rawdash/issue/RAW-134)).
  - `BaseConnector` gains a default `serializeConfig()` implementation; custom connectors extending `BaseConnector` inherit it transparently.

- Updated dependencies [12f27e0]
  - @rawdash/core@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies [0f069f7]
  - @rawdash/core@0.1.0
