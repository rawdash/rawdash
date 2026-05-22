import { serve as honoServe } from '@hono/node-server';
import { mountEngine } from '@rawdash/hono';
import type { DashboardConfig, ServerStorage } from '@rawdash/server';

export interface ServeOptions {
  port?: number;
  storage?: ServerStorage;
}

/**
 * Local-only convenience: mount the engine on a Hono app and bind it to
 * a Node TCP port. Equivalent to `mountEngine(config, options).app` +
 * `@hono/node-server`. Use this only in long-lived Node deployments —
 * serverless/edge runtimes should mount the Hono app directly.
 */
export function serve(
  config: DashboardConfig,
  options: ServeOptions = {},
): void {
  const { port = 8080, storage } = options;
  const { app } = mountEngine(config, { storage });
  honoServe({ fetch: app.fetch, port });
}
