import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { computeMetric } from '@rawdash/server';
import { z } from 'zod';

import type { RuntimeConfig } from '../runtime-config';
import type { McpServerOptions } from '../types';
import { err, text } from './shared';

export function registerReadWidget(
  server: McpServer,
  runtime: RuntimeConfig,
  storage: McpServerOptions['storage'],
): void {
  server.tool(
    'read_widget',
    'Fetch resolved widget data. Returns the same shape as the HTTP read API.',
    {
      dashboard_id: z.string().describe('The dashboard ID.'),
      widget_id: z.string().describe('The widget ID.'),
    },
    async ({ dashboard_id, widget_id }) => {
      const dashboard = runtime.getDashboards()[dashboard_id];
      if (!dashboard) {
        return err('NOT_FOUND', `Dashboard "${dashboard_id}" not found`);
      }
      const widget = dashboard.widgets[widget_id];
      if (!widget) {
        return err('NOT_FOUND', `Widget "${widget_id}" not found`);
      }

      if (widget.kind === 'status') {
        const syncState = await storage.getSyncState();
        return text({
          id: widget_id,
          widgetId: widget_id,
          connectorId: widget.source,
          data: null,
          cachedAt: syncState.lastSyncAt,
        });
      }

      const { connectorId } = widget.metric;
      const connectorEntry = runtime
        .getConnectors()
        .find((e) => e.connector.id === connectorId);
      if (!connectorEntry) {
        return err(
          'CONNECTOR_NOT_FOUND',
          `Connector "${connectorId}" not found`,
        );
      }

      const handle = storage.getStorageHandle(connectorId);
      const data = await computeMetric(handle, widget.metric);
      const syncState = await storage.getSyncState();

      return text({
        id: widget_id,
        widgetId: widget_id,
        connectorId,
        data,
        cachedAt: syncState.lastSyncAt,
      });
    },
  );
}
