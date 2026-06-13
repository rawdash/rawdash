---
'@rawdash/connector-langfuse': minor
---

Add `@rawdash/connector-langfuse` - sync LLM traces (as entities), daily observation volume + token + cost rollups by model (as metrics), and daily score averages by name (as metrics) from a Langfuse project. Authenticates over HTTP Basic auth using a Langfuse public + secret API key pair scoped to one project; supports Langfuse Cloud (`https://cloud.langfuse.com` + the US / EU regional variants) and self-hosted instances via a configurable `host`.
