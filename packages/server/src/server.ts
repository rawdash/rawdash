import { Hono } from 'hono';

import type { RouterMount } from './router';

export function createServer(routers: RouterMount[]): Hono {
  const app = new Hono();
  for (const router of routers) {
    router.mount(app);
  }
  return app;
}
