import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

import { McpRuntime } from './runtime-config';
import { registerAddConnector } from './tools/add-connector';
import { registerListConnectors } from './tools/list-connectors';
import { registerListDashboards } from './tools/list-dashboards';
import { registerListSecrets } from './tools/list-secrets';
import { registerListWidgets } from './tools/list-widgets';
import { registerReadWidget } from './tools/read-widget';
import { registerRemoveConnector } from './tools/remove-connector';
import { registerRenderWidget } from './tools/render-widget';
import { registerSetSecret } from './tools/set-secret';
import { registerTriggerSync } from './tools/trigger-sync';
import type { McpServerOptions } from './types';

export function createMcpServer(options: McpServerOptions): McpServer {
  const { name = 'rawdash', version = '1.0.0', config, storage } = options;

  const server = new McpServer({ name, version });
  const runtime = new McpRuntime(config);
  const trackedSecrets = new Set<string>();

  registerListDashboards(server, runtime);
  registerListWidgets(server, runtime);
  registerReadWidget(server, runtime, storage);
  registerRenderWidget(server, runtime, storage);
  registerListConnectors(server, runtime, storage);
  registerAddConnector(server, runtime, options);
  registerRemoveConnector(server, runtime, options);
  registerSetSecret(server, trackedSecrets, options);
  registerListSecrets(server, trackedSecrets, options);
  registerTriggerSync(server, runtime, storage);

  return server;
}
