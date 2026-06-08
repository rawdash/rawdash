import { getHealth } from '@rawdash/server';
import { Hono } from 'hono';

export function createHealthRouter(): Hono {
  const app = new Hono();
  app.get('/', (c) => c.json(getHealth()));
  return app;
}
