import { serve as honoServe } from '@hono/node-server';

import { createServer } from './server';
import type { DashboardConfig, ServeOptions } from './types';

export { createServer } from './server';
export type {
  DashboardConfig,
  ServeOptions,
  ServerStorage,
  SyncState,
  WidgetEntry,
} from './types';

export function serve(
  config: DashboardConfig,
  options: ServeOptions = {},
): void {
  const { port = 8080, storage } = options;
  const app = createServer(config, storage);
  honoServe({ fetch: app.fetch, port });
}
