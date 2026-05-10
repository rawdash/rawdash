import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { RuntimeConfig } from '../runtime-config';
import { err, text } from './shared';

export function registerListWidgets(
  server: McpServer,
  runtime: RuntimeConfig,
): void {
  server.tool(
    'list_widgets',
    'List all widgets on a dashboard.',
    {
      dashboard_id: z
        .string()
        .describe('The dashboard ID to list widgets for.'),
    },
    ({ dashboard_id }) => {
      const dashboard = runtime.getDashboards()[dashboard_id];
      if (!dashboard) {
        return Promise.resolve(
          err('NOT_FOUND', `Dashboard "${dashboard_id}" not found`),
        );
      }
      const widgets = Object.entries(dashboard.widgets).map(([id, widget]) => ({
        id,
        kind: widget.kind,
        title: widget.title,
        ...(widget.kind !== 'status'
          ? { connectorId: widget.metric.connectorId }
          : { source: widget.source }),
      }));
      return Promise.resolve(text({ dashboard_id, widgets }));
    },
  );
}
