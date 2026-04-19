import { Hono } from 'hono';

import type { RawdashPlugin } from './plugin';

export function createServer(plugins: RawdashPlugin[]): Hono {
  const app = new Hono();
  for (const plugin of plugins) {
    plugin.mount(app);
  }
  return app;
}
