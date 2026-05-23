---
'@rawdash/server': patch
---

Loop chunked connector results in `runSync` instead of erroring out.

`runSync` previously called `connector.sync({ mode: 'full' })` exactly once and pushed a `"did not complete in one chunk (chunked syncs are only supported in cloud)"` error whenever a connector returned `{ done: false }`. In practice that hard-failed every realistic GitHub repo (and other paginated connectors), so OSS dashboards could not complete a sync.

The runner now threads the returned `cursor` back into the next `connector.sync({ mode: 'full', cursor })` call and keeps looping until the connector returns `done: true`. The existing per-connector `AbortController` / `FULL_SYNC_TIMEOUT_MS` budget is shared across all chunks so a runaway connector still can't pin sync state in `running`. A new `FULL_SYNC_MAX_CHUNKS = 1000` safety net fails the run if a connector returns `done: false` indefinitely without progressing.

Cloud's cross-restart cursor persistence keeps working on top of the same connector contract — this only fixes the in-process OSS loop.
