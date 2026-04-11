import { serve as honoServe } from '@hono/node-server';

import { createServer } from './server';
import type { RawdashServerConfig, ServeOptions } from './types';

export { createServer } from './server';
export type {
  ConnectorEntry,
  RawdashServerConfig,
  ServeOptions,
  SyncState,
  WidgetEntry,
} from './types';

export function serve(
  config: RawdashServerConfig,
  options: ServeOptions = {},
): void {
  const { port = 8080 } = options;
  const app = createServer(config);
  honoServe({ fetch: app.fetch, port });
}
