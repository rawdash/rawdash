---
'@rawdash/core': patch
---

Export `DEFAULT_SYNC_STATE`, the canonical "no runs yet" `SyncState` (`status: 'idle'`, all timestamps null), alongside `ACTIVE_SYNC_STATUSES`. `ServerStorage` implementers can return it when no sync run has been recorded instead of re-encoding the shape.
