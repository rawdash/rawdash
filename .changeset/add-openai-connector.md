---
'@rawdash/connector-openai': minor
'@rawdash/connectors': patch
---

Add `@rawdash/connector-openai`, a new connector that syncs the OpenAI organization Usage and Costs admin APIs into twelve daily metric series: completions input / output tokens + requests, embeddings input tokens + requests, images count + requests, audio_speeches characters + requests, audio_transcriptions seconds + requests, and cost in USD. Authenticates with an OpenAI admin API key (sk-admin-) and supports optional organization and project-id scoping; lookback window defaults to 30 days (capped at 180).
