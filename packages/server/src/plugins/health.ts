import type { Hono } from 'hono';

import type { RawdashPlugin } from '../plugin';
import type { InMemoryStorage } from '../storage';

export class HealthPlugin implements RawdashPlugin {
  constructor(private storage: InMemoryStorage) {}

  mount(app: Hono): void {
    app.get('/health', (c) => {
      return c.json(this.storage.getSyncState());
    });
  }
}
