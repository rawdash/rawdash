---
'@rawdash/server': minor
'@rawdash/client': minor
---

`GET /dashboards/:id/widgets` now returns a `{ widgets: CachedWidgetData[] }` envelope instead of a bare top-level array. This leaves room to add sibling metadata (pagination cursors, sync state, error envelopes, etc.) without another breaking change.

The `@rawdash/client` SDK (`http().getWidgets()`) unwraps `.widgets` internally, so consumers using the SDK still receive `CachedWidgetData[]` and need no changes. Anyone calling the HTTP endpoint directly (without the SDK) needs to read from the `widgets` field.
