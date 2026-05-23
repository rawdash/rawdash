import type {
  CachedWidget,
  ConnectorRegistry,
  DashboardConfig,
} from '@rawdash/core';
import { describe, expect, it, vi } from 'vitest';

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
import type { WidgetCache, WidgetCacheKey } from './widget-cache';

const CONNECTOR_NAME = 'test';

class MockConnector {
  static readonly credentials = undefined;
  readonly id = 'test';
  constructor(
    _settings: Record<string, unknown>,
    _creds?: Record<string, unknown>,
  ) {}
  serializeConfig(): Record<string, unknown> {
    return {};
  }
  async sync(): Promise<{ done: boolean }> {
    return { done: true };
  }
}

const connectorRegistry: ConnectorRegistry = {
  test: MockConnector as unknown as ConnectorRegistry[string],
};

const config: DashboardConfig = {
  connectors: [{ name: CONNECTOR_NAME, connectorId: 'test', config: {} }],
  dashboards: {
    main: {
      widgets: {
        my_widget: {
          kind: 'stat',
          title: 'My Widget',
          metric: {
            connectorId: CONNECTOR_NAME,
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
  const ctx: InProcessTriggerSyncContext = {
    getConfig: () => config,
    getStorage: () => storage,
    connectorRegistry,
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
      await triggerSync({ ...ctx }, { mode: 'deferred' });
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
    const { ctx, storage } = makeCtx();
    const handle = storage.getStorageHandle(CONNECTOR_NAME);
    await handle.event({
      name: 'run',
      start_ts: Date.now(),
      end_ts: null,
      attributes: {},
    });
    const res = await getWidget(ctx, 'main', 'my_widget');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') {
      return;
    }
    expect(res.widget.widgetId).toBe('my_widget');
    expect(res.etag).toMatch(/^".+-[0-9a-f]{8}"$/);
  });

  it('omits ETag on "ok" when the widget has no lastSyncAt', async () => {
    const { ctx } = makeCtx();
    const res = await getWidget(ctx, 'main', 'my_widget');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') {
      return;
    }
    expect(res.etag).toBeUndefined();
  });

  it('does not honor If-None-Match when the widget has no lastSyncAt', async () => {
    const { ctx } = makeCtx();
    const res = await getWidget(ctx, 'main', 'my_widget', {
      ifNoneMatch: '"null-deadbeef"',
    });
    expect(res.status).toBe('ok');
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

  it('returns "not-modified" when If-None-Match matches and skips resolveWithCache', async () => {
    const { ctx, storage } = makeCtx();
    const handle = storage.getStorageHandle(CONNECTOR_NAME);
    await handle.event({
      name: 'run',
      start_ts: Date.now(),
      end_ts: null,
      attributes: {},
    });
    const first = await getWidget(ctx, 'main', 'my_widget');
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') {
      return;
    }
    expect(first.etag).toBeDefined();

    let getCalls = 0;
    const cache: WidgetCache = {
      get: async () => {
        getCalls += 1;
        return undefined;
      },
      set: async () => {},
    };
    const second = await getWidget(ctx, 'main', 'my_widget', {
      ifNoneMatch: first.etag,
      cache,
    });
    expect(second.status).toBe('not-modified');
    if (second.status !== 'not-modified') {
      return;
    }
    expect(second.etag).toBe(first.etag);
    expect(getCalls).toBe(0);
  });

  it('config change invalidates the ETag even when lastSyncAt is unchanged', async () => {
    const { ctx, storage } = makeCtx();
    const handle = storage.getStorageHandle(CONNECTOR_NAME);
    await handle.event({
      name: 'run',
      start_ts: Date.now(),
      end_ts: null,
      attributes: {},
    });
    const first = await getWidget(ctx, 'main', 'my_widget');
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') {
      return;
    }
    const firstEtag = first.etag;

    const editedConfig: DashboardConfig = {
      ...config,
      dashboards: {
        main: {
          widgets: {
            my_widget: {
              ...config.dashboards['main']!.widgets['my_widget']!,
              title: 'Renamed Widget',
            },
          },
        },
      },
    };
    const editedCtx: InProcessTriggerSyncContext = {
      getConfig: () => editedConfig,
      getStorage: () => storage,
      connectorRegistry,
    };
    const second = await getWidget(editedCtx, 'main', 'my_widget', {
      ifNoneMatch: firstEtag,
    });
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') {
      return;
    }
    expect(second.etag).not.toBe(firstEtag);
  });
});

class MapWidgetCache implements WidgetCache {
  store = new Map<string, CachedWidget>();
  getCalls = 0;
  setCalls = 0;
  private k(key: WidgetCacheKey): string {
    return `${key.dashboardId}/${key.widgetId}`;
  }
  async get(key: WidgetCacheKey): Promise<CachedWidget | undefined> {
    this.getCalls += 1;
    return this.store.get(this.k(key));
  }
  async set(key: WidgetCacheKey, value: CachedWidget): Promise<void> {
    this.setCalls += 1;
    this.store.set(this.k(key), value);
  }
}

describe('widget cache', () => {
  it('listWidgets calls cache.get and populates via cache.set on miss', async () => {
    const { ctx } = makeCtx();
    const cache = new MapWidgetCache();
    const res = await listWidgets(ctx, 'main', cache);
    expect(res.widgets).toHaveLength(1);
    expect(cache.getCalls).toBe(1);
    expect(cache.setCalls).toBe(1);
    expect(cache.store.size).toBe(1);
  });

  it('listWidgets returns the cached value on hit and skips resolution', async () => {
    const { ctx } = makeCtx();
    const cache = new MapWidgetCache();
    const sentinel: CachedWidget = {
      widgetId: 'my_widget',
      connectorId: 'test',
      data: { hit: true },
      cachedAt: null,
    };
    cache.store.set('main/my_widget', sentinel);
    const res = await listWidgets(ctx, 'main', cache);
    expect(res.widgets[0]).toBe(sentinel);
    expect(cache.setCalls).toBe(0);
  });

  it('getWidget passes widget through to cache key', async () => {
    const { ctx } = makeCtx();
    const cache = new MapWidgetCache();
    const getSpy = vi.spyOn(cache, 'get');
    await getWidget(ctx, 'main', 'my_widget', { cache });
    expect(getSpy).toHaveBeenCalledTimes(1);
    const key = getSpy.mock.calls[0]![0];
    expect(key.dashboardId).toBe('main');
    expect(key.widgetId).toBe('my_widget');
    expect(key.widget.kind).toBe('stat');
  });

  it('cache.get errors fall through to fresh resolution', async () => {
    const { ctx } = makeCtx();
    const cache: WidgetCache = {
      get: async () => {
        throw new Error('boom');
      },
      set: async () => {},
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await listWidgets(ctx, 'main', cache);
    expect(res.widgets).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('cache.set errors are logged but do not fail the response', async () => {
    const { ctx } = makeCtx();
    const cache: WidgetCache = {
      get: async () => undefined,
      set: async () => {
        throw new Error('boom');
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await getWidget(ctx, 'main', 'my_widget', { cache });
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.widget.widgetId).toBe('my_widget');
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('omitted cache → no behavior change', async () => {
    const { ctx } = makeCtx();
    const res = await listWidgets(ctx, 'main');
    expect(res.widgets).toHaveLength(1);
  });
});
