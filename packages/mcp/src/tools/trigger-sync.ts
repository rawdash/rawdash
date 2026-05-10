import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';

import type { RuntimeConfig } from '../runtime-config';
import type { McpServerOptions } from '../types';
import { err, text } from './shared';

export function registerTriggerSync(
  server: McpServer,
  runtime: RuntimeConfig,
  storage: McpServerOptions['storage'],
): void {
  server.tool(
    'trigger_sync',
    'Kick off a sync for one or all connectors. Runs in the background and returns immediately once started.',
    {
      connector_id: z
        .string()
        .optional()
        .describe('Connector ID to sync. Omit to sync all connectors.'),
      mode: z
        .enum(['full', 'latest'])
        .optional()
        .describe(
          '"latest" (default) fetches only recent data. "full" re-fetches all historical data.',
        ),
    },
    async ({ connector_id, mode = 'latest' }) => {
      const connectors = runtime.getConnectors();
      const targets = connector_id
        ? connectors.filter((e) => e.connector.id === connector_id)
        : connectors;

      if (connector_id && targets.length === 0) {
        return err('NOT_FOUND', `Connector "${connector_id}" not found`);
      }

      const acquired = await storage.setSyncing();
      if (!acquired) {
        return err('ALREADY_SYNCING', 'A sync is already in progress');
      }

      const controller = new AbortController();

      const run = async () => {
        try {
          for (const entry of targets) {
            const handle = storage.getStorageHandle(entry.connector.id);
            await entry.connector.sync(
              { mode: mode ?? 'latest' },
              handle,
              controller.signal,
            );
          }
          await storage.setSyncSuccess();
        } catch (e) {
          await storage.setSyncError(
            e instanceof Error ? e.message : String(e),
          );
        }
      };

      void run();

      return text({
        triggered: true,
        connectors: targets.map((e) => e.connector.id),
        mode,
      });
    },
  );
}
