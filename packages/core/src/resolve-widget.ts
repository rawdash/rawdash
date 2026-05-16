import { computeMetric } from './compute';
import type { ConnectorEntry, Widget } from './config';
import type { WidgetEntry } from './engine';
import type { ServerStorage } from './server-storage';

export async function resolveWidget(
  id: string,
  widget: Widget,
  connectors: ConnectorEntry[],
  storage: ServerStorage,
): Promise<WidgetEntry | undefined> {
  if (widget.kind === 'status') {
    return {
      id,
      widgetId: id,
      connectorId: widget.source,
      data: null,
      cachedAt: null,
    };
  }
  const { connectorId } = widget.metric;
  const connectorEntry = connectors.find((e) => e.connector.id === connectorId);
  if (!connectorEntry) {
    return undefined;
  }
  const handle = storage.getStorageHandle(connectorId);
  const data = await computeMetric(handle, widget.metric);
  return {
    id,
    widgetId: id,
    connectorId,
    data,
    cachedAt: (await storage.getSyncState()).lastSyncAt,
  };
}
