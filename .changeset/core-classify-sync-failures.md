---
'@rawdash/core': minor
---

Classify sync failures inside the connector lifecycle so transient infrastructure problems no longer push a healthy connector toward `paused`. `SyncFailureKind` now has three categories: `retryable-infra` (transient, our side) retries with backoff **without** advancing the pause counter, `connector-fault` (the default when a `sync-failed` event omits `kind`) takes the normal error → `paused` escalation path, and `terminal` (e.g. revoked credentials) moves to `auth_failed`. `advanceConnectorLifecycle` honors each kind accordingly.

Breaking: the `SyncFailureKind` values changed from `'transient' | 'auth'` to `'retryable-infra' | 'connector-fault' | 'terminal'`. Deployments map their own concrete error types onto these kinds (e.g. the cloud maps `TenantDatabaseUnavailableError` → `retryable-infra`).
