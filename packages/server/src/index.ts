import { serve as honoServe } from '@hono/node-server';

import { createServer } from './server.js';
import type { RawdashServerConfig, ServeOptions } from './types.js';

export { createServer } from './server.js';
export type {
  ConnectorEntry,
  RawdashServerConfig,
  ServeOptions,
  SyncState,
  WidgetEntry,
} from './types.js';

export function serve(
  config: RawdashServerConfig,
  options: ServeOptions = {},
): void {
  const { port = 3001 } = options;
  const app = createServer(config);
  honoServe({ fetch: app.fetch, port });
}
