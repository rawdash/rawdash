import { serve as honoServe } from '@hono/node-server';

import { createServer } from './server';
import type { DashboardConfig, ServeOptions } from './types';

export { createServer } from './server';
export type {
  DashboardConfig,
  ServeOptions,
  SyncState,
  WidgetEntry,
} from './types';

export function serve(
  config: DashboardConfig,
  options: ServeOptions = {},
): void {
  const { port = 8080 } = options;
  const app = createServer(config);
  honoServe({ fetch: app.fetch, port });
}
