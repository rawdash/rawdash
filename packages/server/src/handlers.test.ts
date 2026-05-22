import type { DashboardConfig } from '@rawdash/core';
import { describe, expect, it } from 'vitest';

import type { EngineContext } from './context';
import { RawdashError } from './errors';
import type { InProcessTriggerSyncContext } from './handlers';
import {
  getHealth,
  getSyncStateHandler,
  getWidget,
  listWidgets,
  triggerSync,
} from './handlers';
import { InMemoryStorage } from './storage';

const CONNECTOR_ID = 'test';

const mockConnector = {
  id: CONNECTOR_ID,
  serializeConfig: () => ({}),
  async sync() {
    return { done: true };
  },
};

const config: DashboardConfig = {
  connectors: [{ connector: mockConnector }],
  dashboards: {
    main: {
      widgets: {
        my_widget: {
          kind: 'stat',
          title: 'My Widget',
          metric: {
            connectorId: CONNECTOR_ID,
            shape: 'event',
            name: 'run',
            field: 'start_ts',
            fn: 'count',
          },
        },
      },
    },
  },
};

function makeCtx() {
  const storage = new InMemoryStorage();
  const ctx: EngineContext = {
    getConfig: () => config,
    getStorage: () => storage,
  };
  return { ctx, storage };
}

describe('getHealth', () => {
  it('returns {status:"ok"}', () => {
    expect(getHealth()).toEqual({ status: 'ok' });
  });
});

describe('getSyncStateHandler', () => {
  it('returns idle state initially', async () => {
    const { ctx } = makeCtx();
    const state = await getSyncStateHandler(ctx);
    expect(state.status).toBe('idle');
    expect(state.lastSyncAt).toBeNull();
  });

  it('reflects storage transitions', async () => {
    const { ctx, storage } = makeCtx();
    await storage.markSyncSucceeded();
    const state = await getSyncStateHandler(ctx);
    expect(state.status).toBe('succeeded');
    expect(state.lastSyncAt).not.toBeNull();
  });
});

describe('triggerSync', () => {
  it('returns {queued: true} on first trigger', async () => {
    const { ctx } = makeCtx();
    const res = await triggerSync(ctx);
    expect(res).toEqual({ queued: true });
  });

  it('returns {queued: false} when a sync is already active', async () => {
    const { ctx, storage } = makeCtx();
    await storage.markSyncQueued();
    await storage.markSyncRunning();
    const res = await triggerSync(ctx);
    expect(res).toEqual({ queued: false });
  });

  it('returns {queued: false} when a sync is already queued', async () => {
    const { ctx, storage } = makeCtx();
    await storage.markSyncQueued();
    const res = await triggerSync(ctx);
    expect(res).toEqual({ queued: false });
  });

  it('persists queued state before returning', async () => {
    const { ctx, storage } = makeCtx();
    await triggerSync(ctx);
    const state = await storage.getSyncState();
    // After triggerSync returns, the state is either still 'queued' (the
    // background runSync hasn't started yet) or already 'running'. Both
    // are valid; what matters is that we passed through 'queued'.
    expect(['queued', 'running', 'succeeded']).toContain(state.status);
    expect(
      state.queuedAt ?? state.startedAt ?? state.lastSyncAt,
    ).not.toBeNull();
  });

  describe('mode: "deferred"', () => {
    it('returns {queued: true} and leaves state in `queued`', async () => {
      const { ctx, storage } = makeCtx();
      const res = await triggerSync(ctx, { mode: 'deferred' });
      expect(res).toEqual({ queued: true });
      const state = await storage.getSyncState();
      expect(state.status).toBe('queued');
      expect(state.queuedAt).not.toBeNull();
      expect(state.startedAt).toBeNull();
      expect(state.lastSyncAt).toBeNull();
    });

    it('does not call getConfig', async () => {
      const storage = new InMemoryStorage();
      let getConfigCalls = 0;
      const ctx: EngineContext = {
        getConfig: () => {
          getConfigCalls += 1;
          return config;
        },
        getStorage: () => storage,
      };
      await triggerSync(ctx, { mode: 'deferred' });
      expect(getConfigCalls).toBe(0);
    });

    it('works without a getConfig at all', async () => {
      const storage = new InMemoryStorage();
      const res = await triggerSync(
        { getStorage: () => storage },
        { mode: 'deferred' },
      );
      expect(res).toEqual({ queued: true });
      expect((await storage.getSyncState()).status).toBe('queued');
    });

    it('returns {queued: false} when a sync is already active', async () => {
      const { ctx, storage } = makeCtx();
      await storage.markSyncQueued();
      await storage.markSyncRunning();
      const res = await triggerSync(ctx, { mode: 'deferred' });
      expect(res).toEqual({ queued: false });
    });
  });

  describe('mode: "in-process" (default)', () => {
    it('throws if getConfig is missing (runtime defense for JS callers)', async () => {
      const storage = new InMemoryStorage();
      // The overloads forbid this at compile time; cast to exercise the
      // runtime guard that protects untyped JS consumers.
      const ctx = {
        getStorage: () => storage,
      } as unknown as InProcessTriggerSyncContext;
      await expect(triggerSync(ctx)).rejects.toThrow(/getConfig is required/);
    });
  });
});

describe('listWidgets', () => {
  it('returns the widgets for an existing dashboard', async () => {
    const { ctx } = makeCtx();
    const res = await listWidgets(ctx, 'main');
    expect(res.widgets).toHaveLength(1);
    expect(res.widgets[0]!.cachedAt).toBeNull();
  });

  it('throws RawdashError(404) for an unknown dashboard', async () => {
    const { ctx } = makeCtx();
    await expect(listWidgets(ctx, 'ghost')).rejects.toMatchObject({
      name: 'RawdashError',
      status: 404,
      code: 'DASHBOARD_NOT_FOUND',
    });
  });
});

describe('getWidget', () => {
  it('returns the widget for valid ids', async () => {
    const { ctx } = makeCtx();
    const w = await getWidget(ctx, 'main', 'my_widget');
    expect(w.widgetId).toBe('my_widget');
  });

  it('throws RawdashError(404) for unknown dashboard', async () => {
    const { ctx } = makeCtx();
    await expect(getWidget(ctx, 'ghost', 'my_widget')).rejects.toBeInstanceOf(
      RawdashError,
    );
  });

  it('throws RawdashError(404) for unknown widget', async () => {
    const { ctx } = makeCtx();
    await expect(getWidget(ctx, 'main', 'ghost')).rejects.toMatchObject({
      status: 404,
      code: 'WIDGET_NOT_FOUND',
    });
  });
});
