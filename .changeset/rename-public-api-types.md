---
'@rawdash/core': minor
'@rawdash/server': minor
'@rawdash/client': minor
'@rawdash/nextjs': minor
'@rawdash/mcp': minor
'@rawdash/cli': minor
'@rawdash/connector-github': minor
'@rawdash/adapter-turso': minor
---

Rename public API types/interfaces/classes for clearer framework ergonomics. Drops noisy suffixes like `Ref`, `Entry`, `Def`, `Response`, and disambiguates several `Metric`-related types.

Breaking renames:

- `SecretRef` → `Secret` (and `isSecretRef` → `isSecret`, `resolveSecretRefs` → `resolveSecrets`)
- `Metric` (data sample) → `MetricSample`
- `MetricDef` → `Metric`
- `ResolvedMetric` → `ComputedMetric` (and `resolvedMetricSchema` → `computedMetricSchema`)
- `ConnectorEntry` → `ConfiguredConnector`
- `WidgetEntry` → `CachedWidget`
- `SyncRequest` → `SyncOptions`
- `RawdashRouter` → `RouterMount`
- `RawdashEngine` (client) → `ServerDataSource`
- `RawdashClient` (nextjs) — removed; use `DataSource` directly
- `RetryOptions` → `RetryPolicy`
- `CredentialEntry` → `CredentialField`
- `CredentialSchema` → `CredentialsSchema`
- `RetentionCandidates` → `RetentionDeletionPlan`
- `McpError` → `McpErrorPayload`
- `RuntimeConfig` (mcp) → `McpRuntime`
- `DiffSet<T>` → `Diff<T>`
- `CloudConnectorEntry` → `CloudConnectorRecord`
- `CloudDashboardEntry` → `CloudDashboardRecord`
- `SecretEntry` → `CloudSecret`
- `CloudConfigBody` → `CloudConfig`
- `CachedWidgetResponse` → `CachedWidgetData`
- `HealthResponse` → `HealthStatus`
- `SyncTriggerResponse` → `SyncResult`
