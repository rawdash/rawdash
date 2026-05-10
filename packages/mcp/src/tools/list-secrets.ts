import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

import type { McpServerOptions } from '../types';
import { text } from './shared';

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
      let names: string[];
      if (options.listSecrets) {
        names = await options.listSecrets();
      } else {
        names = [...trackedSecrets];
      }
      return text({ secrets: names.sort() });
    },
  );
}
