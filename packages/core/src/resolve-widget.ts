import { computeMetric } from './compute';
import type { ConnectorEntry, Widget } from './config';
import type { WidgetEntry } from './engine';
import type { ServerStorage } from './server-storage';

export async function resolveWidget(
  id: string,
  widget: Widget,
  connectors: ConnectorEntry[] | readonly string[] | undefined,
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
  if (
    connectors !== undefined &&
    !isAllowedConnector(connectors, connectorId)
  ) {
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

function isAllowedConnector(
  connectors: ConnectorEntry[] | readonly string[],
  connectorId: string,
): boolean {
  if (connectors.length === 0) {
    return false;
  }
  if (typeof connectors[0] === 'string') {
    return (connectors as readonly string[]).includes(connectorId);
  }
  return (connectors as ConnectorEntry[]).some(
    (e) => e.connector.id === connectorId,
  );
}
