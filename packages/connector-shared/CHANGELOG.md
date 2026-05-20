# @rawdash/connector-shared

## 0.11.0

### Major Changes

- Require `resource` on `request()`. `RequestOptions.resource` is now a required `string` (previously `string | undefined`). The shape-drift pipeline groups observations by `(connector, resource)` end-to-end; leaving it optional meant unguarded call sites silently produced observations the cron could not attribute. TypeScript now blocks any call site that omits it.
- `paginateLink` / `paginateCursor` / `paginatePage` now take a final `{ resource }` argument and forward it to `request()`.
- Drop `private: true` — `@rawdash/connector-shared` is now published.

## 0.1.0

### Minor Changes

- d8379f0: Add optional `observer` hook to the shared `request()` helper. Hosts can pass a callback (with optional `resource`/`requestId`) via `RequestOptions` to inspect parsed responses before the connector receives them. Observer errors are caught and logged, async observers are awaited with a 250ms timeout, and when no observer is supplied the request path is unchanged.
