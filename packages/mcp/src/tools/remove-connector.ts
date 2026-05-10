import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { RuntimeConfig } from '../runtime-config';
import type { McpServerOptions } from '../types';
import { err, text } from './shared';

export function registerRemoveConnector(
  server: McpServer,
  runtime: RuntimeConfig,
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
        return err('NOT_FOUND', `Connector "${connector_id}" not found`);
      }

      await options.onRemoveConnector?.(connector_id);

      return text({ removed: connector_id });
    },
  );
}
