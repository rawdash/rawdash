import type { Hono } from 'hono';

export interface RouterMount {
  mount(app: Hono): void;
}
