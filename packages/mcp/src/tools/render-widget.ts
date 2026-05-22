import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { computeMetric } from '@rawdash/core';
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
                text: renderStatus(widget.title, widget.source, syncState),
              },
            ],
          };
        }

        const { connectorId } = widget.metric;
        const connectorEntry = runtime
          .getConnectors()
          .find((e) => e.name === connectorId);
        if (!connectorEntry) {
          return err(
            'CONNECTOR_NOT_FOUND',
            `Connector "${connectorId}" not found`,
          );
        }

        const handle = storage.getStorageHandle(connectorId);
        const data = await computeMetric(handle, widget.metric);

        let rendered: string;

        if (widget.kind === 'stat') {
          rendered = renderStat(widget.title, data);
        } else if (widget.kind === 'timeseries') {
          const points = Array.isArray(data)
            ? (data as Array<{ date: string; value: unknown }>)
            : [];
          rendered = renderTimeseries(widget.title, points);
        } else if (widget.kind === 'distribution') {
          rendered = renderDistribution(widget.title, data);
        } else {
          rendered = `## ${(widget as { title: string }).title}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
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
