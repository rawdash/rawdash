---
'@rawdash/connector-shared': minor
'@rawdash/core': minor
'@rawdash/server': minor
'@rawdash/connector-github': minor
'@rawdash/connector-sentry': minor
'@rawdash/connector-linear': minor
'@rawdash/connector-stripe': minor
'@rawdash/connector-vercel': minor
---

Connectors now emit structured INFO progress logs during sync.

Adds a `ConnectorLogger` interface (`info` / `warn`) exposed on `ConnectorContext` and accessible via `this.logger` on `BaseConnector`. The default implementation writes single-line, key=value formatted records to stdout/stderr with a stable `[<scope>]` prefix.

`paginateChunked` now emits one INFO line per page fetch (`fetched page resource=… page=… items=… cursor=…`), one per resource completion (`resource done resource=… pages=… items=… duration_ms=…`), and a WARN line when a page fetch or batch write fails. `runSync` wraps each connector run in `[runner] sync started` / `[runner] sync settled status=… duration_ms=…` envelopes.

All five OSS connectors (github, sentry, linear, stripe, vercel) pass `this.logger` into `paginateChunked`, so a multi-minute sync now produces a continuous, parseable stream of progress lines instead of silence between queued and succeeded.
