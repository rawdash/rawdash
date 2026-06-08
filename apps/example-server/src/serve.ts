import { serve as honoServe } from '@hono/node-server';
import { mountEngine } from '@rawdash/hono';
import type {
  ConnectorRegistry,
  DashboardConfig,
  ServerStorage,
} from '@rawdash/server';

export interface ServeOptions {
  port?: number;
  storage?: ServerStorage;
  connectorRegistry: ConnectorRegistry;
}

export function serve(config: DashboardConfig, options: ServeOptions): void {
  const { port = 8080, storage, connectorRegistry } = options;
  const { app } = mountEngine(config, { storage, connectorRegistry });
  honoServe({ fetch: app.fetch, port });
}
