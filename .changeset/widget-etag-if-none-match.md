---
'@rawdash/server': minor
'@rawdash/hono': minor
'@rawdash/sdk-client': minor
'@rawdash/core': minor
---

**New:** ETag / `If-None-Match` on the per-widget endpoint (`GET /dashboards/:id/widgets/:widgetId`). Turns no-op polls from the subscription engine (RAW-323) into cheap `304 Not Modified` responses, skipping `resolveWithCache` (and the underlying `resolveWidget` + connector storage hits) entirely on match.

The ETag is `"<lastSyncAt>-<configHash>"`. Including `configHash` ensures a widget-config edit invalidates the cached ETag even when `lastSyncAt` hasn't advanced.

- `@rawdash/core` — new exports: `computeWidgetEtag`, `hashWidgetConfig`.
- `@rawdash/server` — `getWidget` signature changed: now accepts `{ cache?, ifNoneMatch? }` options and returns `{ status: 'ok', etag, widget } | { status: 'not-modified', etag }`. Breaking change for callers that consume `getWidget` directly; `@rawdash/hono` is updated.
- `@rawdash/hono` — widget router emits `ETag` on 200 and `304` when `If-None-Match` matches.
- `@rawdash/sdk-client` — `http()` transparently caches the last-seen ETag per `(dashboardId, widgetId)`, sends `If-None-Match` on subsequent fetches, and returns the cached body on 304.

The bundle endpoint (`GET /dashboards/:id/widgets`) is intentionally out of scope. No changes in `@rawdash/sdk-runtime`.
