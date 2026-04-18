import type { Hono } from 'hono';

import type { RawdashIntegration } from '../integration';
import type { InMemoryStorage } from '../storage';

export class HealthIntegration implements RawdashIntegration {
  constructor(private storage: InMemoryStorage) {}

  mount(app: Hono): void {
    app.get('/health', (c) => {
      return c.json(this.storage.getSyncState());
    });
  }
}
