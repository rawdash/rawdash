import { serve as honoServe } from '@hono/node-server';

import { createEngineIntegrations } from './engine-integration';
import { createServer } from './server';
import type { DashboardConfig, ServeOptions } from './types';

export { createServer } from './server';
export { createEngineIntegrations } from './engine-integration';
export type { RawdashIntegration } from './integration';
export type { SyncState, WidgetEntry } from '@rawdash/core';
export type { DashboardConfig, ServeOptions } from './types';

export function serve(
  config: DashboardConfig,
  options: ServeOptions = {},
): void {
  const { port = 8080 } = options;
  const app = createServer(createEngineIntegrations(config));
  honoServe({ fetch: app.fetch, port });
}
