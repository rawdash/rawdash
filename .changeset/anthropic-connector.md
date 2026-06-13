---
'@rawdash/connector-anthropic': minor
---

Add `@rawdash/connector-anthropic` — syncs daily Claude token usage (uncached input, output, cache-read, cache-creation), web-search tool requests, and USD spend from the Anthropic Admin Usage and Cost Report endpoints. Authenticates with an organization admin API key (sk-ant-admin-) and supports an optional `workspaceIds` filter plus a `resources` allowlist so usage and cost can be requested independently.
