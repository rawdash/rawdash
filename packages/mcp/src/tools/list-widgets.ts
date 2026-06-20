import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { widgetConnectorIds } from '@rawdash/core';
import { z } from 'zod';

import type { McpRuntime } from '../runtime-config';
import { err, text } from './shared';

export function registerListWidgets(
  server: McpServer,
  runtime: McpRuntime,
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
      const widgets = Object.entries(dashboard.widgets).map(([id, widget]) => {
        const connectorIds = widgetConnectorIds(widget);
        return {
          id,
          kind: widget.kind,
          title: widget.title,
          connectorId: connectorIds[0],
          connectorIds,
        };
      });
      return Promise.resolve(text({ dashboard_id, widgets }));
    },
  );
}
