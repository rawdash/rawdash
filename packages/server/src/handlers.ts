import type {
  CachedWidget,
  HealthResponse,
  SyncState,
  TriggerSyncResponse,
  WidgetsListResponse,
} from '@rawdash/core';
import { isSyncActive, resolveWidget } from '@rawdash/core';

import type { EngineContext } from './context';
import { RawdashError } from './errors';
import { runRetention } from './retention';
import { runSync } from './sync';

/**
 * Framework-agnostic request handlers for the rawdash wire contract.
 *
 * Each function takes an `EngineContext` (providing per-request access to
 * the config + storage) and returns the response body, or throws a
 * `RawdashError` on a client-visible failure. HTTP adapters
 * (`@rawdash/hono`, etc.) wrap these in their framework's request/response
 * cycle and translate `RawdashError` into a structured error response.
 */

export function getHealth(): HealthResponse {
  return { status: 'ok' };
}

export async function getSyncStateHandler(
  ctx: EngineContext,
): Promise<SyncState> {
  const storage = await ctx.getStorage();
  return storage.getSyncState();
}

export async function triggerSync(
  ctx: EngineContext,
): Promise<TriggerSyncResponse> {
  const storage = await ctx.getStorage();
  const state = await storage.getSyncState();
  if (isSyncActive(state.status)) {
    return { queued: false };
  }
  const config = await ctx.getConfig();
  void runSync(config, storage).catch((err) => {
    console.error('Rawdash sync failed', err);
  });
  return { queued: true };
}

export async function listWidgets(
  ctx: EngineContext,
  dashboardId: string,
): Promise<WidgetsListResponse> {
  const config = await ctx.getConfig();
  const dashboard = config.dashboards[dashboardId];
  if (!dashboard) {
    throw new RawdashError(404, 'DASHBOARD_NOT_FOUND', 'Dashboard not found');
  }
  const storage = await ctx.getStorage();
  const entries = Object.entries(dashboard.widgets);
  const resolved = await Promise.all(
    entries.map(([key, widget]) =>
      resolveWidget(key, widget, config.connectors, storage),
    ),
  );
  const widgets = resolved.filter((w): w is CachedWidget => w !== undefined);
  return { widgets };
}

export async function getWidget(
  ctx: EngineContext,
  dashboardId: string,
  widgetId: string,
): Promise<CachedWidget> {
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
  const result = await resolveWidget(
    widgetId,
    widget,
    config.connectors,
    storage,
  );
  if (!result) {
    throw new RawdashError(404, 'WIDGET_NOT_FOUND', 'Widget not found');
  }
  return result;
}

export async function runRetentionOnce(ctx: EngineContext): Promise<void> {
  const config = await ctx.getConfig();
  const storage = await ctx.getStorage();
  await runRetention(config, storage);
}
