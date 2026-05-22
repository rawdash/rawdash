import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

import type { McpRuntime } from '../runtime-config';
import type { McpServerOptions } from '../types';
import { err, text } from './shared';

export function registerListConnectors(
  server: McpServer,
  runtime: McpRuntime,
  storage: McpServerOptions['storage'],
): void {
  server.tool(
    'list_connectors',
    'List all configured connectors and their sync status.',
    {},
    async () => {
      try {
        const syncState = await storage.getSyncState();
        const connectors = runtime.getConnectors().map((entry) => ({
          id: entry.name,
          connectorId: entry.connectorId,
          syncStatus: syncState.status,
          lastSyncAt: syncState.lastSyncAt,
          lastError: syncState.lastError,
          configKeys: Object.keys(entry.config),
        }));
        return text({ connectors, overallSyncStatus: syncState.status });
      } catch (e) {
        return err(
          'LIST_CONNECTORS_FAILED',
          e instanceof Error ? e.message : String(e),
        );
      }
    },
  );
}
