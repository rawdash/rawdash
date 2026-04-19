import { serve as honoServe } from '@hono/node-server';

import { createEnginePlugins } from './engine-plugin';
import { createServer } from './server';
import type { DashboardConfig, ServeOptions } from './types';

export { createServer } from './server';
export { createEnginePlugins } from './engine-plugin';
export type { RawdashPlugin } from './plugin';
export type { SyncState, WidgetEntry } from '@rawdash/core';
export type { DashboardConfig, ServeOptions } from './types';

export function serve(
  config: DashboardConfig,
  options: ServeOptions = {},
): void {
  const { port = 8080 } = options;
  const app = createServer(createEnginePlugins(config));
  honoServe({ fetch: app.fetch, port });
}
