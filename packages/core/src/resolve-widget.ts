import { classifyWidget, readAggregate } from './aggregate';
import { computeMetric } from './compute';
import type { Widget } from './config';
import type { ConnectorHealth } from './connector';
import type { ServerStorage } from './server-storage';
import type { CachedWidget, WidgetSyncState } from './wire';

const FAILING_CONNECTOR_STATUSES: ReadonlySet<ConnectorHealth['status']> =
  new Set(['error', 'auth_failed', 'paused']);

function deriveSyncStateFromHealth(health: ConnectorHealth): WidgetSyncState {
  if (health.status === 'syncing') {
    return 'syncing';
  }
  if (FAILING_CONNECTOR_STATUSES.has(health.status)) {
    return 'failing';
  }
  if (!health.lastSyncAt) {
    return 'unsynced';
  }
  const ageMs = Date.now() - new Date(health.lastSyncAt).getTime();
  const windowMs = 2 * health.syncIntervalSeconds * 1000;
  return ageMs <= windowMs ? 'fresh' : 'stale';
}

function buildMetaFromHealth(health: ConnectorHealth): Record<string, unknown> {
  const meta: Record<string, unknown> = { connectorStatus: health.status };
  if (health.lastError) {
    meta['lastError'] = health.lastError;
  }
  return meta;
}

export async function resolveWidget(
  dashboardId: string,
  widgetId: string,
  widget: Widget,
  connectors: readonly string[] | undefined,
  storage: ServerStorage,
): Promise<CachedWidget | undefined> {
  const connectorId =
    widget.kind === 'status' ? widget.source : widget.metric.connectorId;
  if (connectors !== undefined && !connectors.includes(connectorId)) {
    return undefined;
  }
  const handle = storage.getStorageHandle(connectorId);
  const health = (await handle.getHealth?.()) ?? null;
  let data: unknown = null;
  if (widget.kind !== 'status') {
    const classification = classifyWidget(widget);
    if (classification.via === 'aggregate') {
      const cached = await readAggregate(handle, dashboardId, widgetId);
      data = cached ? cached.value : await computeMetric(handle, widget.metric);
    } else {
      data = await computeMetric(handle, widget.metric);
    }
  }

  let syncState: WidgetSyncState | undefined;
  let meta: Record<string, unknown> | undefined;
  if (health) {
    syncState = deriveSyncStateFromHealth(health);
    meta = buildMetaFromHealth(health);
  } else if (data === null || data === undefined) {
    syncState = 'unsynced';
  } else {
    syncState = 'fresh';
  }

  return {
    widgetId,
    connectorId,
    data,
    cachedAt: health?.lastSyncAt ?? null,
    syncState,
    syncIntervalSeconds: health?.syncIntervalSeconds,
    meta,
  };
}
