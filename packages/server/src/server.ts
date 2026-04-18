import { Hono } from 'hono';

import type { RawdashIntegration } from './integration';

export function createServer(integrations: RawdashIntegration[]): Hono {
  const app = new Hono();
  for (const integration of integrations) {
    integration.mount(app);
  }
  return app;
}
