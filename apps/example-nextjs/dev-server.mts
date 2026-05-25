import { serve as honoServe } from '@hono/node-server';
import { SqliteStorage } from '@rawdash/adapter-sqlite';
import { GitHubConnector } from '@rawdash/connector-github';
import type { ServerStorage } from '@rawdash/core';
import { InMemoryStorage } from '@rawdash/core';
import { mountEngine } from '@rawdash/hono';

import config from './rawdash.config.mts';

function resolvePort(): number {
  const raw = process.env['PORT'];
  if (raw === undefined || raw === '') {
    return 8080;
  }
  const parsed = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    console.warn(
      `Invalid PORT env var "${raw}" — falling back to default port 8080`,
    );
    return 8080;
  }
  return parsed;
}

function resolveStorage(): ServerStorage {
  if (process.env['RAWDASH_STORAGE'] === 'memory') {
    return new InMemoryStorage();
  }
  return new SqliteStorage('.rawdash/storage.sqlite');
}

const { app } = mountEngine(config, {
  connectorRegistry: { 'github-actions': GitHubConnector },
  storage: resolveStorage(),
});
honoServe({ fetch: app.fetch, port: resolvePort() });
