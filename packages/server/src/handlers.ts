import type {
  CachedWidget,
  ConnectorRegistry,
  HealthResponse,
  SecretsResolver,
  SyncState,
  TriggerSyncResponse,
  WidgetsListResponse,
} from '@rawdash/core';
import { isSyncActive, resolveWidget } from '@rawdash/core';
import type { DashboardConfig, ServerStorage } from '@rawdash/core';

import type { EngineContext } from './context';
import { RawdashError } from './errors';
import { runRetention } from './retention';
import { runSync } from './sync';

/**
 * Per-request lookup shape accepted by `triggerSync` in deferred mode.
 * `getConfig` is optional because the trigger handler never calls
 * `runSync` — deployments that delegate the actual sync work to an
 * external runner may not be able to materialize a `DashboardConfig` at
 * request time.
 */
export interface DeferredTriggerSyncContext {
  getConfig?: () => DashboardConfig | Promise<DashboardConfig>;
  getStorage: () => ServerStorage | Promise<ServerStorage>;
}

/**
 * Per-request lookup shape accepted by `triggerSync` in in-process
 * mode. `getConfig` is required because the trigger handler kicks off
 * `runSync(config, storage)` in the background. `connectorRegistry` is
 * required so the background runner can instantiate connector
 * implementations on demand from the declarative `DashboardConfig`.
 */
export interface InProcessTriggerSyncContext {
  getConfig: () => DashboardConfig | Promise<DashboardConfig>;
  getStorage: () => ServerStorage | Promise<ServerStorage>;
  connectorRegistry: ConnectorRegistry;
  secretsResolver?: SecretsResolver;
}

/**
 * @deprecated Prefer `InProcessTriggerSyncContext` /
 * `DeferredTriggerSyncContext`. Retained as the union for callers that
 * need a single type covering both modes.
 */
export type TriggerSyncContext = DeferredTriggerSyncContext;

export type TriggerSyncMode = 'in-process' | 'deferred';

export interface TriggerSyncOptions {
  /**
   * `'in-process'` (default): the trigger handler also runs the sync in
   * the background by invoking `runSync(config, storage)`. Suitable for
   * self-hosted, single-process deployments.
   *
   * `'deferred'`: the trigger handler only persists the `queued`
   * transition and returns. The `running → succeeded/failed` transitions
   * are the responsibility of an external runner (e.g. a queue consumer
   * worker), which must drive the storage accordingly.
   */
  mode?: TriggerSyncMode;
}

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
  }).catch((err) => {
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
  const connectorNames = config.connectors.map((c) => c.name);
  const entries = Object.entries(dashboard.widgets);
  const resolved = await Promise.all(
    entries.map(([key, widget]) =>
      resolveWidget(key, widget, connectorNames, storage),
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
  const connectorNames = config.connectors.map((c) => c.name);
  const result = await resolveWidget(widgetId, widget, connectorNames, storage);
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
