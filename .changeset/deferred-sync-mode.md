---
'@rawdash/server': patch
'@rawdash/hono': patch
---

Add deferred-runner mode to `triggerSync` (`@rawdash/server`) and `createSyncRouter` (`@rawdash/hono`). Pass `mode: 'deferred'` to skip `runSync` and the `getConfig` call — the handler only persists the `queued` transition, leaving `running → succeeded/failed` to an external runner (e.g. a queue consumer worker). Default `mode: 'in-process'` keeps existing behavior unchanged.
