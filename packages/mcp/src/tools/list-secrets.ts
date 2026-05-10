import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

import type { McpServerOptions } from '../types';
import { err, text } from './shared';

export function registerListSecrets(
  server: McpServer,
  trackedSecrets: Set<string>,
  options: Pick<McpServerOptions, 'listSecrets'>,
): void {
  server.tool(
    'list_secrets',
    'List secret names known to this Rawdash instance. Values are never returned.',
    {},
    async () => {
      try {
        const names = options.listSecrets
          ? await options.listSecrets()
          : [...trackedSecrets];
        return text({ secrets: [...names].sort() });
      } catch (e) {
        return err(
          'LIST_SECRETS_FAILED',
          e instanceof Error ? e.message : 'Failed to list secrets.',
        );
      }
    },
  );
}
