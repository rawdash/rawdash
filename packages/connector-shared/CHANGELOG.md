# @rawdash/connector-shared

## 0.3.0

### Minor Changes

- 022cbf1: Connectors now emit structured INFO progress logs during sync.

  Adds a `ConnectorLogger` interface (`info` / `warn`) exposed on `ConnectorContext` and accessible via `this.logger` on `BaseConnector`. The default implementation writes single-line, key=value formatted records to stdout/stderr with a stable `[<scope>]` prefix.

  `paginateChunked` now emits one INFO line per page fetch (`fetched page resource=… page=… items=… cursor=…`), one per resource completion (`resource done resource=… pages=… items=… duration_ms=…`), and a WARN line when a page fetch or batch write fails. `runSync` wraps each connector run in `[runner] sync started` / `[runner] sync settled status=… duration_ms=…` envelopes.

  All five OSS connectors (github, sentry, linear, stripe, vercel) pass `this.logger` into `paginateChunked`, so a multi-minute sync now produces a continuous, parseable stream of progress lines instead of silence between queued and succeeded.

  Operators can BYO logger by passing `loggerFactory: (scope) => ConnectorLogger` to `mountEngine`, `createSyncRouter`, `createEngine`, `triggerSync`, or `runSync` directly. The factory is invoked with `'runner'` for the runner envelopes and with each connector instance name for that connector's logger; omit it to keep the default stdout impl.

## 0.2.0

### Minor Changes

- 8ee5006: Require `resource` on `request()` in `@rawdash/connector-shared`, and propagate it through `BaseConnector` in `@rawdash/core`.

  `RequestOptions.resource` is now a required `string` (previously `string | undefined`). The shape-drift pipeline groups observations by `(connector, resource)` end-to-end — leaving it optional meant unguarded call sites silently produced observations the cron could not attribute. TypeScript now blocks any call site that omits it.

  `BaseConnector` now exposes protected `request` / `get` / `post` helpers that take a required `resource` and forward an observer from a new optional `ConnectorContext` (third constructor argument). Connector authors only add `{ resource: '...' }` to each HTTP call site — no observer plumbing.

  `paginateLink` / `paginateCursor` / `paginatePage` now take a trailing `{ resource }` argument and forward it to the underlying `request()` call, so paginated paths are attributed consistently.

  All three OSS connectors (`github-actions`, `stripe`, `google-analytics`) updated to route every HTTP call through the base helpers with a resource name matching their schema keys.

## 0.1.0

### Minor Changes

- d8379f0: Add optional `observer` hook to the shared `request()` helper. Hosts can pass a callback (with optional `resource`/`requestId`) via `RequestOptions` to inspect parsed responses before the connector receives them. Observer errors are caught and logged, async observers are awaited with a 250ms timeout, and when no observer is supplied the request path is unchanged.
