---
'@rawdash/core': minor
'@rawdash/server': minor
'@rawdash/hono': minor
'@rawdash/mcp': minor
'@rawdash/cli': minor
---

**Breaking:** Split declarative `DashboardConfig` from runtime `Connector` instances.

`DashboardConfig.connectors` is now an array of declarative entries (`{ name, connectorId, config, syncIntervalSeconds?, enabled?, displayName? }`) instead of `{ connector: Connector }` wrappers around live instances. Connector implementations are wired separately via a `connectorRegistry` option on `mountEngine`, `createSyncRouter`, `createEngine`, and `triggerSync` (in-process mode). `secretsResolver` is exposed as the same per-deployment channel.

Migration:

```ts
// before
const github = new GitHubConnector(
  { owner: 'acme', repo: 'web' },
  { token: secret('GH_TOKEN') },
);
mountEngine(
  defineConfig({
    connectors: [{ connector: github }],
    dashboards: { /* ... */ },
  }),
  { storage },
);

// after
const github = {
  name: 'main',
  connectorId: 'github-actions',
  config: { owner: 'acme', repo: 'web', token: secret('GH_TOKEN') },
};
mountEngine(
  defineConfig({
    connectors: [github],
    dashboards: { /* ... */ },
  }),
  {
    connectorRegistry: { 'github-actions': GitHubConnector },
    storage,
  },
);
```

Same config object now works in-process, in deferred-runner mode, and in cloud. `resolveWidget` accepts `readonly string[] | undefined` (connector instance names) instead of the previous `ConfiguredConnector[] | string[]` union. `toWireConfig` is now a near-identity passthrough; the wire format is the in-memory shape.
