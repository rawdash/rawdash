import type { Hono } from 'hono';

import type { RouterMount } from '../router';
import type { ServerStorage } from '../types';

export class HealthRouter implements RouterMount {
  constructor(private storage: ServerStorage) {}

  mount(app: Hono): void {
    app.get('/health', async (c) => {
      return c.json(await this.storage.getSyncState());
    });
  }
}
