---
'@rawdash/core': minor
'@rawdash/client': minor
'@rawdash/nextjs': minor
'@rawdash/server': minor
---

Consolidate HTTP wire-format types in `@rawdash/core` so the server and any other backend implementation (including the hosted cloud) can typecheck against the same response contract the SDK consumes. Two production bugs in the last week traced back to silent OSS↔cloud drift; one canonical home eliminates the class.

New module `@rawdash/core/wire` exports:

- `CachedWidget<TData = unknown>` — was `CachedWidgetData` in `@rawdash/client`; consolidated with the old `CachedWidget` from `@rawdash/core/engine`. Now generic, `data: TData | null`, optional `syncState`/`meta`. The dead duplicate `id` field is removed (it was always set to the same value as `widgetId`).
- `WidgetsListResponse` — `{ widgets: CachedWidget[] }` envelope returned by `GET /dashboards/:id/widgets`.
- `TriggerSyncResponse` — `{ triggered: boolean }`, renamed from the old `SyncResult` in `@rawdash/client` to resolve the name collision with `SyncResult` from `@rawdash/core/connector` (which is a connector-iteration result, not an HTTP response).
- `WidgetSyncState` — moved from `@rawdash/client`.
- `DataSource`, `ServerDataSource` — moved from `@rawdash/client`.

Breaking:

- `@rawdash/client` no longer exports `CachedWidgetData`, `HealthStatus`, `SyncResult` (for the HTTP-trigger response), `WidgetSyncState`, `DataSource`, `ServerDataSource`. Import from `@rawdash/core` instead. `HealthStatus` has been removed entirely — it was identical to `SyncState`, which already lived in `@rawdash/core`.
- `@rawdash/nextjs` no longer re-exports those types; import from `@rawdash/core`.
- `@rawdash/server` no longer re-exports `SyncState`/`CachedWidget`; import from `@rawdash/core`.
- `CachedWidget.id` removed.
- `resolveWidget`'s first parameter is now named `widgetId` (was `id`) — call sites unchanged behaviorally.

Consumers of the SDK that only use the `http()` / `createRawdashClient()` factories see no runtime change; only import paths for type-only references need updating.
