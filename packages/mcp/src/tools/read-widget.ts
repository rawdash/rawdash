import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import {
  mergeSeries,
  mergeSeriesScalar,
  statusSources,
  widgetMetrics,
} from '@rawdash/core';
import { z } from 'zod';

import type { McpRuntime } from '../runtime-config';
import type { McpServerOptions } from '../types';
import { resolveMcpSeries } from './series';
import { err, text } from './shared';

export function registerReadWidget(
  server: McpServer,
  runtime: McpRuntime,
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
      try {
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
          const sources = statusSources(widget);
          return text({
            id: widget_id,
            widgetId: widget_id,
            connectorId: sources[0],
            data: null,
            cachedAt: syncState.lastSyncAt,
          });
        }

        const resolved = await resolveMcpSeries(
          widgetMetrics(widget),
          runtime,
          storage,
        );
        if (!resolved.ok) {
          return err(
            'CONNECTOR_NOT_FOUND',
            `Connector "${resolved.connectorId}" not found`,
          );
        }
        const { series } = resolved;
        const syncState = await storage.getSyncState();
        const isMulti = Array.isArray(widget.metric);

        if (!isMulti) {
          return text({
            id: widget_id,
            widgetId: widget_id,
            connectorId: series[0]!.connectorId,
            data: series[0]!.data,
            cachedAt: syncState.lastSyncAt,
          });
        }

        let aggregated: unknown = null;
        if (widget.aggregate) {
          if (widget.kind === 'stat') {
            aggregated = mergeSeriesScalar(series, { fn: widget.aggregate.fn });
          } else if (widget.kind === 'timeseries') {
            aggregated = mergeSeries(series, { fn: widget.aggregate.fn });
          }
        }

        return text({
          id: widget_id,
          widgetId: widget_id,
          connectorId: series[0]!.connectorId,
          data: aggregated,
          series,
          cachedAt: syncState.lastSyncAt,
        });
      } catch (e) {
        return err('READ_FAILED', e instanceof Error ? e.message : String(e));
      }
    },
  );
}
