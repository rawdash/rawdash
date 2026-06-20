import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import {
  computeMetric,
  mergeSeries,
  mergeSeriesScalar,
  statusSources,
  widgetMetrics,
} from '@rawdash/core';
import { z } from 'zod';

import type { McpRuntime } from '../runtime-config';
import type { McpServerOptions } from '../types';
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

        const metrics = widgetMetrics(widget);
        const knownNames = new Set(runtime.getConnectors().map((e) => e.name));
        const missing = metrics.find((m) => !knownNames.has(m.connectorId));
        if (missing) {
          return err(
            'CONNECTOR_NOT_FOUND',
            `Connector "${missing.connectorId}" not found`,
          );
        }

        const series = await Promise.all(
          metrics.map(async (metric) => ({
            key: metric.label ?? metric.connectorId,
            connectorId: metric.connectorId,
            label: metric.label ?? metric.connectorId,
            data: await computeMetric(
              storage.getStorageHandle(metric.connectorId),
              metric,
            ),
          })),
        );
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

        const aggregated = widget.aggregate
          ? widget.kind === 'stat'
            ? mergeSeriesScalar(series, { fn: widget.aggregate.fn })
            : mergeSeries(series, { fn: widget.aggregate.fn })
          : null;

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
