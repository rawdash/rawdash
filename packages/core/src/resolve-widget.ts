import { computeMetric } from './compute';
import type { Widget } from './config';
import type { ServerStorage } from './server-storage';
import type { CachedWidget } from './wire';

export async function resolveWidget(
  widgetId: string,
  widget: Widget,
  connectors: readonly string[] | undefined,
  storage: ServerStorage,
): Promise<CachedWidget | undefined> {
  if (widget.kind === 'status') {
    return {
      widgetId,
      connectorId: widget.source,
      data: null,
      cachedAt: null,
    };
  }
  const { connectorId } = widget.metric;
  if (connectors !== undefined && !connectors.includes(connectorId)) {
    return undefined;
  }
  const handle = storage.getStorageHandle(connectorId);
  const data = await computeMetric(handle, widget.metric);
  return {
    widgetId,
    connectorId,
    data,
    cachedAt: (await storage.getSyncState()).lastSyncAt,
  };
}
