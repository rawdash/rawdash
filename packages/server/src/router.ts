import type { Hono } from 'hono';

export interface RawdashRouter {
  mount(app: Hono): void;
}
