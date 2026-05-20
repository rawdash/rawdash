---
'@rawdash/client': minor
'@rawdash/nextjs': minor
---

Model the unsynced widget state in `CachedWidgetData`:

- `data` is now `TData | null`. A widget that has never been synced legitimately has no data.
- New optional `syncState: 'synced' | 'unsynced' | 'syncing' | 'error'` and `meta: Record<string, unknown>` fields capture sync metadata. Self-hosted servers can simply omit them.
- New `WidgetSyncState` type is exported from `@rawdash/client` and re-exported from `@rawdash/nextjs`.

Backwards compatible for the common case (existing SDK consumers that always called the server after a sync), but the type widening of `data` may surface unchecked `null` cases in consumer code — TypeScript will flag them.
