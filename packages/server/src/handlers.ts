import type {
  CachedWidget,
  ConnectorRegistry,
  HealthResponse,
  SecretsResolver,
  SyncState,
  TriggerSyncResponse,
  Widget,
  WidgetsListResponse,
} from '@rawdash/core';
import {
  computeWidgetEtag,
  isSyncActive,
  resolveWidget,
  widgetConnectorIds,
} from '@rawdash/core';
import type { DashboardConfig, ServerStorage } from '@rawdash/core';

import type { EngineContext } from './context';
import { RawdashError } from './errors';
import { runRetention } from './retention';
import { type ConnectorLoggerFactory, runSync } from './sync';
import type { WidgetCache } from './widget-cache';

async function cacheGetSafe(
  cache: WidgetCache,
  dashboardId: string,
  widgetId: string,
  widget: Widget,
): Promise<CachedWidget | undefined> {
  try {
    return await cache.get({ dashboardId, widgetId, widget });
  } catch (err) {
    console.warn('Rawdash widget cache get failed', err);
    return undefined;
  }
}

async function cacheSetSafe(
  cache: WidgetCache,
  dashboardId: string,
  widgetId: string,
  widget: Widget,
  value: CachedWidget,
): Promise<void> {
  try {
    await cache.set({ dashboardId, widgetId, widget }, value);
  } catch (err) {
    console.warn('Rawdash widget cache set failed', err);
  }
}

async function resolveWithCache(
  dashboardId: string,
  widgetId: string,
  widget: Widget,
  connectorNames: readonly string[],
  storage: ServerStorage,
  cache: WidgetCache | undefined,
): Promise<CachedWidget | undefined> {
  if (cache) {
    const hit = await cacheGetSafe(cache, dashboardId, widgetId, widget);
    if (hit) {
      return hit;
    }
  }
  const fresh = await resolveWidget(
    dashboardId,
    widgetId,
    widget,
    connectorNames,
    storage,
  );
  if (fresh && cache) {
    await cacheSetSafe(cache, dashboardId, widgetId, widget, fresh);
  }
  return fresh;
}

export interface DeferredTriggerSyncContext {
  getConfig?: () => DashboardConfig | Promise<DashboardConfig>;
  getStorage: () => ServerStorage | Promise<ServerStorage>;
}

export interface InProcessTriggerSyncContext {
  getConfig: () => DashboardConfig | Promise<DashboardConfig>;
  getStorage: () => ServerStorage | Promise<ServerStorage>;
  connectorRegistry: ConnectorRegistry;
  secretsResolver?: SecretsResolver;
  loggerFactory?: ConnectorLoggerFactory;
}

export type TriggerSyncContext = DeferredTriggerSyncContext;

export type TriggerSyncMode = 'in-process' | 'deferred';

export interface TriggerSyncOptions {
  mode?: TriggerSyncMode;
}

export function getHealth(): HealthResponse {
  return { status: 'ok' };
}

export async function getSyncStateHandler(
  ctx: EngineContext,
): Promise<SyncState> {
  const storage = await ctx.getStorage();
  return storage.getSyncState();
}

export function triggerSync(
  ctx: InProcessTriggerSyncContext,
  opts?: { mode?: 'in-process' },
): Promise<TriggerSyncResponse>;
export function triggerSync(
  ctx: DeferredTriggerSyncContext,
  opts: { mode: 'deferred' },
): Promise<TriggerSyncResponse>;
export async function triggerSync(
  ctx: InProcessTriggerSyncContext | DeferredTriggerSyncContext,
  opts: TriggerSyncOptions = {},
): Promise<TriggerSyncResponse> {
  const mode: TriggerSyncMode = opts.mode ?? 'in-process';
  const storage = await ctx.getStorage();
  const state = await storage.getSyncState();
  if (isSyncActive(state.status)) {
    return { queued: false };
  }
  let config: DashboardConfig | undefined;
  if (mode === 'in-process') {
    if (!ctx.getConfig) {
      throw new Error(
        'triggerSync: getConfig is required when mode is "in-process"',
      );
    }
    config = await ctx.getConfig();
  }
  const queued = await storage.markSyncQueued();
  if (!queued) {
    return { queued: false };
  }
  if (mode === 'deferred') {
    return { queued: true };
  }
  const inProcessCtx = ctx as InProcessTriggerSyncContext;
  void runSync(config!, storage, {
    connectorRegistry: inProcessCtx.connectorRegistry,
    secretsResolver: inProcessCtx.secretsResolver,
    loggerFactory: inProcessCtx.loggerFactory,
  }).catch((err) => {
    console.error('Rawdash sync failed', err);
  });
  return { queued: true };
}

export async function listWidgets(
  ctx: EngineContext,
  dashboardId: string,
  cache?: WidgetCache,
): Promise<WidgetsListResponse> {
  const config = await ctx.getConfig();
  const dashboard = config.dashboards[dashboardId];
  if (!dashboard) {
    throw new RawdashError(404, 'DASHBOARD_NOT_FOUND', 'Dashboard not found');
  }
  const storage = await ctx.getStorage();
  const connectorNames = config.connectors.map((c) => c.name);
  const entries = Object.entries(dashboard.widgets);
  const resolved = await Promise.all(
    entries.map(([key, widget]) =>
      resolveWithCache(
        dashboardId,
        key,
        widget,
        connectorNames,
        storage,
        cache,
      ),
    ),
  );
  const widgets = resolved.filter((w): w is CachedWidget => w !== undefined);
  return { widgets };
}

export interface GetWidgetOptions {
  cache?: WidgetCache;
  ifNoneMatch?: string;
}

export type GetWidgetResult =
  | { status: 'ok'; etag: string | undefined; widget: CachedWidget }
  | { status: 'not-modified'; etag: string };

export async function getWidget(
  ctx: EngineContext,
  dashboardId: string,
  widgetId: string,
  opts: GetWidgetOptions = {},
): Promise<GetWidgetResult> {
  const { cache, ifNoneMatch } = opts;
  const config = await ctx.getConfig();
  const dashboard = config.dashboards[dashboardId];
  if (!dashboard) {
    throw new RawdashError(404, 'DASHBOARD_NOT_FOUND', 'Dashboard not found');
  }
  const widget = dashboard.widgets[widgetId];
  if (!widget) {
    throw new RawdashError(404, 'WIDGET_NOT_FOUND', 'Widget not found');
  }
  const storage = await ctx.getStorage();
  const connectorNames = config.connectors.map((c) => c.name);
  const connectorIds = widgetConnectorIds(widget);
  if (!connectorIds.some((id) => connectorNames.includes(id))) {
    throw new RawdashError(404, 'WIDGET_NOT_FOUND', 'Widget not found');
  }

  if (ifNoneMatch) {
    const healths = await Promise.all(
      connectorIds.map((id) => storage.getHealth(id)),
    );
    const lastSyncAt = healths.reduce<string | null>((newest, health) => {
      if (!health?.lastSyncAt) {
        return newest;
      }
      if (newest === null || health.lastSyncAt > newest) {
        return health.lastSyncAt;
      }
      return newest;
    }, null);
    if (lastSyncAt) {
      const probeEtag = computeWidgetEtag(lastSyncAt, widget);
      if (probeEtag === ifNoneMatch) {
        return { status: 'not-modified', etag: probeEtag };
      }
    }
  }

  const result = await resolveWithCache(
    dashboardId,
    widgetId,
    widget,
    connectorNames,
    storage,
    cache,
  );
  if (!result) {
    throw new RawdashError(404, 'WIDGET_NOT_FOUND', 'Widget not found');
  }
  const etag = result.cachedAt
    ? computeWidgetEtag(result.cachedAt, widget)
    : undefined;
  return { status: 'ok', etag, widget: result };
}

export async function runRetentionOnce(ctx: EngineContext): Promise<void> {
  const config = await ctx.getConfig();
  const storage = await ctx.getStorage();
  await runRetention(config, storage);
}
