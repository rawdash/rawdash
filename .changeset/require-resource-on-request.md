---
'@rawdash/connector-shared': minor
'@rawdash/core': minor
---

Require `resource` on `request()` in `@rawdash/connector-shared`, and propagate it through `BaseConnector` in `@rawdash/core`.

`RequestOptions.resource` is now a required `string` (previously `string | undefined`). The shape-drift pipeline groups observations by `(connector, resource)` end-to-end — leaving it optional meant unguarded call sites silently produced observations the cron could not attribute. TypeScript now blocks any call site that omits it.

`BaseConnector` now exposes protected `request` / `get` / `post` helpers that take a required `resource` and forward an observer from a new optional `ConnectorContext` (third constructor argument). Connector authors only add `{ resource: '...' }` to each HTTP call site — no observer plumbing.

`paginateLink` / `paginateCursor` / `paginatePage` now take a trailing `{ resource }` argument and forward it to the underlying `request()` call, so paginated paths are attributed consistently.

All three OSS connectors (`github-actions`, `stripe`, `google-analytics`) updated to route every HTTP call through the base helpers with a resource name matching their schema keys.
