import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { RuntimeConfig } from '../runtime-config';
import type { McpServerOptions } from '../types';
import { text } from './shared';

export function registerListConnectors(
  server: McpServer,
  runtime: RuntimeConfig,
  storage: McpServerOptions['storage'],
): void {
  server.tool(
    'list_connectors',
    'List all configured connectors and their sync status.',
    {},
    async () => {
      const syncState = await storage.getSyncState();
      const connectors = runtime.getConnectors().map((entry) => ({
        id: entry.connector.id,
        syncStatus: syncState.status,
        lastSyncAt: syncState.lastSyncAt,
        lastError: syncState.lastError,
        hasCredentials:
          Object.keys(entry.connector.credentials ?? {}).length > 0,
        credentialKeys: Object.keys(entry.connector.credentials ?? {}),
      }));
      return text({ connectors, overallSyncStatus: syncState.status });
    },
  );
}
