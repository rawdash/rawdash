import type { DashboardConfig, SyncState } from '@rawdash/server';
import { InMemoryStorage } from '@rawdash/server';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createHealthRouter } from './health';
import { createSyncRouter, createSyncStateRouter } from './sync';

const emptyConfig: DashboardConfig = { connectors: [], dashboards: {} };

function makeApp() {
  const storage = new InMemoryStorage();
  const app = new Hono();
  app.route(
    '/sync',
    createSyncRouter({
      getConfig: () => emptyConfig,
      getStorage: () => storage,
    }),
  );
  app.route(
    '/sync/state',
    createSyncStateRouter({ getStorage: () => storage }),
  );
  app.route('/health', createHealthRouter());
  return { app, storage };
}

describe('createHealthRouter', () => {
  it('returns {status:"ok"}', async () => {
    const { app } = makeApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('createSyncStateRouter', () => {
  it('exposes the SyncState', async () => {
    const { app, storage } = makeApp();
    const res1 = await app.request('/sync/state');
    const s1 = (await res1.json()) as SyncState;
    expect(s1.status).toBe('idle');

    await storage.markSyncSucceeded();
    const res2 = await app.request('/sync/state');
    const s2 = (await res2.json()) as SyncState;
    expect(s2.status).toBe('succeeded');
    expect(s2.lastSyncAt).not.toBeNull();
  });
});

describe('createSyncRouter', () => {
  it('POST /sync returns {queued: true} on first trigger', async () => {
    const { app } = makeApp();
    const res = await app.request('/sync', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: true });
  });

  it('POST /sync returns {queued: false} when active', async () => {
    const { app, storage } = makeApp();
    await storage.markSyncQueued();
    await storage.markSyncRunning();
    const res = await app.request('/sync', { method: 'POST' });
    expect(await res.json()).toEqual({ queued: false });
  });

  describe('mode: "deferred"', () => {
    it('returns {queued: true} and leaves state in `queued`', async () => {
      const storage = new InMemoryStorage();
      const app = new Hono();
      app.route(
        '/sync',
        createSyncRouter({
          mode: 'deferred',
          getStorage: () => storage,
        }),
      );
      app.route(
        '/sync/state',
        createSyncStateRouter({ getStorage: () => storage }),
      );

      const res = await app.request('/sync', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ queued: true });

      const stateRes = await app.request('/sync/state');
      const state = (await stateRes.json()) as SyncState;
      expect(state.status).toBe('queued');
    });

    it('does not call getConfig', async () => {
      const storage = new InMemoryStorage();
      let getConfigCalls = 0;
      const app = new Hono();
      app.route(
        '/sync',
        createSyncRouter({
          mode: 'deferred',
          getStorage: () => storage,
          getConfig: () => {
            getConfigCalls += 1;
            return emptyConfig;
          },
        }),
      );
      await app.request('/sync', { method: 'POST' });
      expect(getConfigCalls).toBe(0);
    });
  });
});
