import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';

import type { McpRuntime } from '../runtime-config';
import type { McpServerOptions } from '../types';
import { err, text } from './shared';

export function registerRemoveConnector(
  server: McpServer,
  runtime: McpRuntime,
  options: Pick<McpServerOptions, 'onRemoveConnector'>,
): void {
  server.tool(
    'remove_connector',
    'Remove a connector from this Rawdash instance. For OSS, this is a runtime-only change. Idempotent — removing a non-existent connector returns success.',
    {
      connector_id: z.string().describe('The connector instance ID to remove.'),
    },
    async ({ connector_id }) => {
      const existed = runtime.removeConnector(connector_id);
      if (!existed) {
        return text({ removed: connector_id, existed: false });
      }

      try {
        await options.onRemoveConnector?.(connector_id);
      } catch (e) {
        return err(
          'ON_REMOVE_CONNECTOR_FAILED',
          `Connector removed in-memory but post-remove callback failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      return text({ removed: connector_id, existed: true });
    },
  );
}
