import { serve as honoServe } from '@hono/node-server';

import { createEngineRouters } from './engine-router';
import { createServer } from './server';
import type { DashboardConfig, ServeOptions } from './types';

export { createServer } from './server';
export { createEngineRouters } from './engine-router';
export type { RawdashRouter } from './router';
export type { SyncState, WidgetEntry } from '@rawdash/core';
export type { DashboardConfig, ServeOptions, ServerStorage } from './types';

export function serve(
  config: DashboardConfig,
  options: ServeOptions = {},
): void {
  const { port = 8080, storage } = options;
  const app = createServer(createEngineRouters(config, storage));
  honoServe({ fetch: app.fetch, port });
}
