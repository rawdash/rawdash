---
'@rawdash/core': patch
---

Widen `@libsql/client` peer dependency range to `>=0.14.0 <1.0.0`. The `LibsqlStorage` API surface (`createClient`, `Client`, `execute`, `batch`, `transaction`) has been stable across 0.14 → 0.17, so the previous `^0.14.0` constraint was artificially narrow and produced peer-dep warnings for consumers on newer 0.x releases.
