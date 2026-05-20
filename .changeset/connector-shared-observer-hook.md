---
'@rawdash/connector-shared': minor
---

Add optional `observer` hook to the shared `request()` helper. Hosts can pass a callback (with optional `resource`/`requestId`) via `RequestOptions` to inspect parsed responses before the connector receives them. Observer errors are caught and logged, async observers are awaited with a 250ms timeout, and when no observer is supplied the request path is unchanged.
