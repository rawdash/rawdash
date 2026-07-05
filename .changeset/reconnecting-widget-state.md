---
'@rawdash/core': patch
'@rawdash/sdk-runtime': patch
---

Distinguish a recoverable, self-healing connector from a hard error in the widget sync state. `resolveWidget` no longer buckets every failing connector status together: it now drives the split off the shared `isRecoverable` predicate, so recoverable statuses (`error`, `paused`) that are retrying resolve to a new `'reconnecting'` `WidgetSyncState` instead of `'failing'`, and no longer mark the widget (or a status widget) as a hard `error`. Only the non-recoverable `auth_failed` status — and genuinely failed metric compute — stay `'failing'` / `error`. The `WidgetSyncState` union gains `'reconnecting'`, and the SDK runtime engine polls a reconnecting widget on the same backoff cadence as a stale one so it can detect recovery.
