import { serve as honoServe } from '@hono/node-server';

import { createServer } from './server';
import type {
  ConnectorEntry,
  RawdashServerConfig,
  ServeOptions,
} from './types';

export { createServer } from './server';
export type {
  ConnectorEntry,
  RawdashServerConfig,
  ServeOptions,
  SyncState,
  WidgetEntry,
} from './types';

export function serve<TEntry extends ConnectorEntry<any, any>>(
  config: RawdashServerConfig<TEntry>,
  options: ServeOptions = {},
): void {
  const { port = 8080 } = options;
  const app = createServer(config);
  honoServe({ fetch: app.fetch, port });
}
