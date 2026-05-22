import { getHealth } from '@rawdash/server';
import { Hono } from 'hono';

/**
 * Liveness probe — returns `{status:'ok'}` synchronously, no storage
 * access. Mount at `/health` (or wherever your platform's probe expects).
 */
export function createHealthRouter(): Hono {
  const app = new Hono();
  app.get('/', (c) => c.json(getHealth()));
  return app;
}
