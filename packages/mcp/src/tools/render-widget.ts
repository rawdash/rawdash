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
import { err } from './shared';

function renderStat(title: string, value: unknown): string {
  const display =
    typeof value === 'number'
      ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : String(value ?? '—');
  return `## ${title}\n\n**${display}**\n`;
}

function renderTimeseries(
  title: string,
  points: Array<{ date: string; value: unknown }>,
): string {
  if (points.length === 0) {
    return `## ${title}\n\n_No data_\n`;
  }
  const rows = points
    .map(
      (p) =>
        `| ${p.date} | ${typeof p.value === 'number' ? p.value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(p.value ?? '—')} |`,
    )
    .join('\n');
  return `## ${title}\n\n| Date | Value |\n|------|-------|\n${rows}\n`;
}

function renderDistribution(title: string, value: unknown): string {
  return `## ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function renderStatus(
  title: string,
  source: string,
  syncState: {
    status: string;
    lastSyncAt: string | null;
    lastError: string | null;
  },
): string {
  const statusEmoji =
    syncState.status === 'succeeded' || syncState.status === 'idle'
      ? '✅'
      : syncState.status === 'queued' || syncState.status === 'running'
        ? '🔄'
        : '❌';
  const lastSync = syncState.lastSyncAt
    ? new Date(syncState.lastSyncAt).toUTCString()
    : 'never';
  return `## ${title}\n\n${statusEmoji} **${syncState.status}** (connector: \`${source}\`)\n\nLast sync: ${lastSync}${syncState.lastError ? `\n\nError: ${syncState.lastError}` : ''}\n`;
}

export function registerRenderWidget(
  server: McpServer,
  runtime: McpRuntime,
  storage: McpServerOptions['storage'],
): void {
  server.tool(
    'render_widget',
    'Render a widget as an inline artifact in the chat. Returns a formatted markdown representation of the widget data.',
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

        const syncState = await storage.getSyncState();

        if (widget.kind === 'status') {
          return {
            content: [
              {
                type: 'text' as const,
                text: renderStatus(
                  widget.title,
                  statusSources(widget).join(', '),
                  syncState,
                ),
              },
            ],
          };
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
        const isMulti = Array.isArray(widget.metric);

        const renderOne = (title: string, data: unknown): string => {
          if (widget.kind === 'stat') {
            return renderStat(title, data);
          }
          if (widget.kind === 'timeseries') {
            const points = Array.isArray(data)
              ? (data as Array<{ date: string; value: unknown }>)
              : [];
            return renderTimeseries(title, points);
          }
          if (widget.kind === 'distribution') {
            return renderDistribution(title, data);
          }
          return `## ${title}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
        };

        let rendered: string;
        if (!isMulti) {
          rendered = renderOne(widget.title, series[0]!.data);
        } else {
          const sections = series.map((s) =>
            renderOne(`${widget.title} — ${s.label}`, s.data),
          );
          if (widget.aggregate) {
            const aggregated =
              widget.kind === 'stat'
                ? mergeSeriesScalar(series, { fn: widget.aggregate.fn })
                : mergeSeries(series, { fn: widget.aggregate.fn });
            sections.unshift(
              renderOne(
                `${widget.title} — ${widget.aggregate.label ?? 'Combined'}`,
                aggregated,
              ),
            );
          }
          rendered = sections.join('\n');
        }

        const cachedNote = syncState.lastSyncAt
          ? `\n_Cached at ${new Date(syncState.lastSyncAt).toUTCString()}_`
          : '\n_Not yet synced_';

        return {
          content: [{ type: 'text' as const, text: rendered + cachedNote }],
        };
      } catch (e) {
        return err('RENDER_FAILED', e instanceof Error ? e.message : String(e));
      }
    },
  );
}
