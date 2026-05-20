import { computeMetric } from './compute';
import type { ConfiguredConnector, Widget } from './config';
import type { ServerStorage } from './server-storage';
import type { CachedWidget } from './wire';

export async function resolveWidget(
  widgetId: string,
  widget: Widget,
  connectors: ConfiguredConnector[] | readonly string[] | undefined,
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
  if (
    connectors !== undefined &&
    !isAllowedConnector(connectors, connectorId)
  ) {
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

function isAllowedConnector(
  connectors: ConfiguredConnector[] | readonly string[],
  connectorId: string,
): boolean {
  if (connectors.length === 0) {
    return false;
  }
  if (typeof connectors[0] === 'string') {
    return (connectors as readonly string[]).includes(connectorId);
  }
  return (connectors as ConfiguredConnector[]).some(
    (e) => e.connector.id === connectorId,
  );
}
