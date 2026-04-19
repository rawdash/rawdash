import type { Hono } from 'hono';

export interface RawdashPlugin {
  mount(app: Hono): void;
}
