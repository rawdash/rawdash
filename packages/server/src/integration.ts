import type { Hono } from 'hono';

export interface RawdashIntegration {
  mount(app: Hono): void;
}
