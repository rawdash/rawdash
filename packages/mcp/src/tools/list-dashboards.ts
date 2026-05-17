import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

import type { McpRuntime } from '../runtime-config';
import { text } from './shared';

export function registerListDashboards(
  server: McpServer,
  runtime: McpRuntime,
): void {
  server.tool(
    'list_dashboards',
    'List all dashboards available on this Rawdash instance.',
    {},
    () => {
      const dashboards = Object.entries(runtime.getDashboards()).map(
        ([id, dashboard]) => ({
          id,
          widgetCount: Object.keys(dashboard.widgets).length,
          widgetIds: Object.keys(dashboard.widgets),
        }),
      );
      return Promise.resolve(text({ dashboards }));
    },
  );
}
