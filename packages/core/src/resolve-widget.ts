import { computeMetricWithStatus } from './compute';
import type { ComputedMetric, Widget } from './config';
import { statusSources, widgetMetrics } from './config';
import type { ConnectorHealth } from './connector';
import { resolveWidgetFormat } from './format';
import { mergeSeries, mergeSeriesScalar } from './series-merge';
import type { ServerStorage } from './server-storage';
import type { ResourcesByConnectorId } from './validate-metrics';
import type {
  CachedWidget,
  WidgetSeries,
  WidgetStatus,
  WidgetSyncState,
} from './wire';

const FAILING_CONNECTOR_STATUSES: ReadonlySet<ConnectorHealth['status']> =
  new Set(['error', 'auth_failed', 'paused']);

const ERROR_CONNECTOR_STATUSES: ReadonlySet<ConnectorHealth['status']> =
  new Set(['error', 'auth_failed']);

const SYNCED_SYNC_STATES: ReadonlySet<WidgetSyncState> = new Set([
  'fresh',
  'stale',
]);

const SYNC_STATE_SEVERITY: Record<WidgetSyncState, number> = {
  failing: 5,
  syncing: 4,
  unsynced: 3,
  stale: 2,
  fresh: 1,
};

function worstSyncState(
  states: readonly WidgetSyncState[],
): WidgetSyncState | undefined {
  let worst: WidgetSyncState | undefined;
  for (const state of states) {
    if (
      worst === undefined ||
      SYNC_STATE_SEVERITY[state] > SYNC_STATE_SEVERITY[worst]
    ) {
      worst = state;
    }
  }
  return worst;
}

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

function newestLastSyncAt(
  healths: readonly (ConnectorHealth | null)[],
): string | null {
  let newest: string | null = null;
  let newestMs = -Infinity;
  for (const health of healths) {
    if (!health?.lastSyncAt) {
      continue;
    }
    const ms = new Date(health.lastSyncAt).getTime();
    if (Number.isFinite(ms) && ms > newestMs) {
      newestMs = ms;
      newest = health.lastSyncAt;
    }
  }
  return newest;
}

interface ResolvedSeries {
  series: WidgetSeries;
  health: ConnectorHealth | null;
}

async function resolveSeries(
  metric: ComputedMetric,
  key: string,
  widget: Exclude<Widget, { kind: 'status' }>,
  storage: ServerStorage,
  resourcesByConnectorId: ResourcesByConnectorId | undefined,
): Promise<ResolvedSeries> {
  const handle = storage.getStorageHandle(metric.connectorId);
  const health = await storage.getHealth(metric.connectorId);

  let data: unknown = null;
  let matchedRows: number | undefined;
  let computeError: string | undefined;
  try {
    const computation = await computeMetricWithStatus(handle, metric);
    data = computation.value;
    matchedRows = computation.matchedRows;
  } catch (err) {
    computeError = err instanceof Error ? err.message : String(err);
  }

  const syncState = health
    ? deriveSyncStateFromHealth(health)
    : data === null || data === undefined
      ? 'unsynced'
      : 'fresh';

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

  const format = widget.format
    ? resolveWidgetFormat(widget.format, metric, resourcesByConnectorId)
    : undefined;

  return {
    health,
    series: {
      key,
      connectorId: metric.connectorId,
      label: metric.label ?? metric.connectorId,
      data,
      status,
      syncState,
      syncIntervalSeconds: health?.syncIntervalSeconds,
      matchedRows,
      format,
      errorMessage,
    },
  };
}

function seriesKeys(metrics: readonly ComputedMetric[]): string[] {
  const used = new Set<string>();
  return metrics.map((m, i) => {
    const base = m.label ?? m.connectorId ?? `series-${i}`;
    let key = base;
    let n = 2;
    while (used.has(key)) {
      key = `${base}-${n++}`;
    }
    used.add(key);
    return key;
  });
}

async function resolveStatusWidget(
  widgetId: string,
  widget: Extract<Widget, { kind: 'status' }>,
  connectors: readonly string[] | undefined,
  storage: ServerStorage,
): Promise<CachedWidget | undefined> {
  const sources = statusSources(widget).filter(
    (s) => connectors === undefined || connectors.includes(s),
  );
  if (sources.length === 0) {
    return undefined;
  }

  const healths = await Promise.all(sources.map((s) => storage.getHealth(s)));
  const series: WidgetSeries[] = sources.map((source, i) => {
    const health = healths[i] ?? null;
    return {
      key: source,
      connectorId: source,
      label: source,
      data: health?.status ?? null,
      syncState: health ? deriveSyncStateFromHealth(health) : 'unsynced',
      syncIntervalSeconds: health?.syncIntervalSeconds,
      errorMessage: connectorErrorMessage(health),
    };
  });

  const syncState =
    worstSyncState(
      series
        .map((s) => s.syncState)
        .filter((s): s is WidgetSyncState => s !== undefined),
    ) ?? 'unsynced';
  const firstError = series.find((s) => s.errorMessage)?.errorMessage;
  const isMulti = Array.isArray(widget.source);
  const primaryHealth = healths[0] ?? null;

  return {
    widgetId,
    connectorId: sources[0]!,
    data: null,
    series: isMulti ? series : undefined,
    cachedAt: newestLastSyncAt(healths),
    syncState,
    syncIntervalSeconds: primaryHealth?.syncIntervalSeconds,
    meta: primaryHealth ? buildMetaFromHealth(primaryHealth) : undefined,
    status: firstError !== undefined ? 'error' : 'ok',
    errorMessage: firstError,
  };
}

export async function resolveWidget(
  dashboardId: string,
  widgetId: string,
  widget: Widget,
  connectors: readonly string[] | undefined,
  storage: ServerStorage,
  resourcesByConnectorId?: ResourcesByConnectorId,
): Promise<CachedWidget | undefined> {
  if (widget.kind === 'status') {
    return resolveStatusWidget(widgetId, widget, connectors, storage);
  }

  const isMulti = Array.isArray(widget.metric);
  const allMetrics = widgetMetrics(widget);
  const keys = seriesKeys(allMetrics);
  const selected = allMetrics
    .map((metric, i) => ({ metric, key: keys[i]! }))
    .filter(
      ({ metric }) =>
        connectors === undefined || connectors.includes(metric.connectorId),
    );
  if (selected.length === 0) {
    return undefined;
  }

  const resolved = await Promise.all(
    selected.map(({ metric, key }) =>
      resolveSeries(metric, key, widget, storage, resourcesByConnectorId),
    ),
  );

  if (!isMulti) {
    const only = resolved[0]!;
    return {
      widgetId,
      connectorId: only.series.connectorId,
      data: only.series.data,
      cachedAt: only.health?.lastSyncAt ?? null,
      syncState: only.series.syncState,
      syncIntervalSeconds: only.series.syncIntervalSeconds,
      format: only.series.format,
      meta: only.health ? buildMetaFromHealth(only.health) : undefined,
      status: only.series.status,
      errorMessage: only.series.errorMessage,
    };
  }

  const series = resolved.map((r) => r.series);
  const healths = resolved.map((r) => r.health);

  const syncState = worstSyncState(
    series
      .map((s) => s.syncState)
      .filter((s): s is WidgetSyncState => s !== undefined),
  );
  const firstError = series.find((s) => s.status === 'error');
  let status: WidgetStatus = 'ok';
  if (firstError) {
    status = 'error';
  } else if (series.every((s) => s.status === 'no_data')) {
    status = 'no_data';
  }

  let data: unknown = null;
  if (widget.aggregate) {
    data =
      widget.kind === 'stat'
        ? mergeSeriesScalar(series, { fn: widget.aggregate.fn })
        : mergeSeries(series, { fn: widget.aggregate.fn });
  }

  const meta: Record<string, unknown> = {
    connectorIds: series.map((s) => s.connectorId),
  };

  return {
    widgetId,
    connectorId: series[0]!.connectorId,
    data,
    series,
    cachedAt: newestLastSyncAt(healths),
    syncState,
    syncIntervalSeconds: series[0]!.syncIntervalSeconds,
    format: series[0]!.format,
    meta,
    status,
    errorMessage: firstError?.errorMessage,
  };
}
