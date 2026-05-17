---
'@rawdash/core': minor
---

`resolveWidget` no longer requires an instantiated `ConnectorEntry[]`. The `connectors` parameter now accepts `ConnectorEntry[] | readonly string[] | undefined`:

- `undefined` skips the membership check entirely — useful in runtimes (e.g. Cloudflare Workers) where connector implementations are not loaded on the read path.
- `readonly string[]` checks membership against a lightweight allowlist of connector ids.
- `ConnectorEntry[]` continues to work as before (backward-compatible).
