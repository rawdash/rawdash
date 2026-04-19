import type { Hono } from 'hono';

import type { RawdashRouter } from '../router';
import type { InMemoryStorage } from '../storage';

export class HealthRouter implements RawdashRouter {
  constructor(private storage: InMemoryStorage) {}

  mount(app: Hono): void {
    app.get('/health', (c) => {
      return c.json(this.storage.getSyncState());
    });
  }
}
