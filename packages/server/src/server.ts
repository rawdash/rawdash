import { Hono } from 'hono';

import type { RawdashRouter } from './router';

export function createServer(routers: RawdashRouter[]): Hono {
  const app = new Hono();
  for (const router of routers) {
    router.mount(app);
  }
  return app;
}
