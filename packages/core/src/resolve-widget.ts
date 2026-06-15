import { computeMetricWithStatus } from './compute';
import type { Widget } from './config';
import type { ConnectorHealth } from './connector';
import { resolveWidgetFormat } from './format';
import type { ServerStorage } from './server-storage';
import type { ResourcesByConnectorId } from './validate-metrics';
import type { CachedWidget, WidgetStatus, WidgetSyncState } from './wire';

const FAILING_CONNECTOR_STATUSES: ReadonlySet<ConnectorHealth['status']> =
  new Set(['error', 'auth_failed', 'paused']);

const ERROR_CONNECTOR_STATUSES: ReadonlySet<ConnectorHealth['status']> =
  new Set(['error', 'auth_failed']);

const SYNCED_SYNC_STATES: ReadonlySet<WidgetSyncState> = new Set([
  'fresh',
  'stale',
]);

function connectorErrorMessage(
  health: ConnectorHealth | null,
): string | undefined {
  if (!health) {
    return undefined;
  }
  if (ERROR_CONNECTOR_STATUSES.has(health.status) || health.lastError != null) {
    return health.lastError ?? `connector status: ${health.status}`;
  }
  return undefined;
}

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
  resourcesByConnectorId?: ResourcesByConnectorId,
): Promise<CachedWidget | undefined> {
  const connectorId =
    widget.kind === 'status' ? widget.source : widget.metric.connectorId;
  if (connectors !== undefined && !connectors.includes(connectorId)) {
    return undefined;
  }
  const handle = storage.getStorageHandle(connectorId);
  const health = await storage.getHealth(connectorId);
  let data: unknown = null;
  let matchedRows: number | undefined;
  let computeError: string | undefined;
  if (widget.kind !== 'status') {
    try {
      const computation = await computeMetricWithStatus(handle, widget.metric);
      data = computation.value;
      matchedRows = computation.matchedRows;
    } catch (err) {
      computeError = err instanceof Error ? err.message : String(err);
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

  let status: WidgetStatus = 'ok';
  let errorMessage: string | undefined;
  const connectorError = connectorErrorMessage(health);
  if (connectorError !== undefined) {
    status = 'error';
    errorMessage = connectorError;
  } else if (computeError !== undefined) {
    status = 'error';
    errorMessage = computeError;
  } else if (
    matchedRows === 0 &&
    syncState !== undefined &&
    SYNCED_SYNC_STATES.has(syncState)
  ) {
    status = 'no_data';
  }

  const widgetFormat =
    widget.kind !== 'status' && widget.format
      ? resolveWidgetFormat(
          widget.format,
          widget.metric,
          resourcesByConnectorId,
        )
      : undefined;

  return {
    widgetId,
    connectorId,
    data,
    cachedAt: health?.lastSyncAt ?? null,
    syncState,
    syncIntervalSeconds: health?.syncIntervalSeconds,
    format: widgetFormat,
    meta,
    status,
    errorMessage,
  };
}
