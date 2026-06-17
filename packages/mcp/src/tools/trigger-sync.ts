import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { instantiateConnector, withMetricResourceGuard } from '@rawdash/core';
import { z } from 'zod';

import type { McpRuntime } from '../runtime-config';
import type { McpServerOptions } from '../types';
import { err, text } from './shared';

export function registerTriggerSync(
  server: McpServer,
  runtime: McpRuntime,
  storage: McpServerOptions['storage'],
  options: Pick<McpServerOptions, 'connectorRegistry' | 'secretsResolver'>,
): void {
  server.tool(
    'trigger_sync',
    'Kick off a sync for one or all connectors. Runs in the background and returns immediately once started.',
    {
      connector_id: z
        .string()
        .optional()
        .describe(
          'Connector instance name to sync. Omit to sync all connectors.',
        ),
      mode: z
        .enum(['full', 'latest'])
        .optional()
        .describe(
          '"latest" (default) fetches only recent data. "full" re-fetches all historical data.',
        ),
    },
    async ({ connector_id, mode = 'latest' }) => {
      if (!options.connectorRegistry) {
        return err(
          'NO_REGISTRY',
          'trigger_sync requires connectorRegistry on McpServerOptions',
        );
      }
      const connectors = runtime.getConnectors();
      const targets = connector_id
        ? connectors.filter((e) => e.name === connector_id)
        : connectors;

      if (connector_id && targets.length === 0) {
        return err('NOT_FOUND', `Connector "${connector_id}" not found`);
      }

      const queued = await storage.markSyncQueued();
      if (!queued) {
        return err('ALREADY_SYNCING', 'A sync is already in progress');
      }
      if (typeof storage.markSyncRunning === 'function') {
        const acquired = await storage.markSyncRunning();
        if (!acquired) {
          return err('ALREADY_SYNCING', 'A sync is already in progress');
        }
      }

      const controller = new AbortController();

      const run = async () => {
        try {
          for (const entry of targets) {
            const connector = instantiateConnector(
              entry,
              options.connectorRegistry!,
              options.secretsResolver,
            );
            const baseHandle = storage.getStorageHandle(entry.name);
            const resourceDefs =
              options.connectorRegistry![entry.connectorId]?.resources;
            const handle = resourceDefs
              ? withMetricResourceGuard(baseHandle, resourceDefs)
              : baseHandle;
            await connector.sync(
              { mode: mode ?? 'latest' },
              handle,
              controller.signal,
            );
          }
          await storage.markSyncSucceeded();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          try {
            await storage.markSyncFailed(message);
          } catch (markErr) {
            console.error('Failed to record sync failure in storage:', markErr);
          }
        }
      };

      void run().catch((rejection) => {
        console.error('Unexpected background sync rejection:', rejection);
      });

      return text({
        triggered: true,
        connectors: targets.map((e) => e.name),
        mode,
      });
    },
  );
}
