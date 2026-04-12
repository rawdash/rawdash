import { Hono } from 'hono';

import { InMemoryStorage } from './storage';
import type { ConnectorEntry, RawdashServerConfig } from './types';

export function createServer<TEntry extends ConnectorEntry>(
  config: RawdashServerConfig<TEntry>,
): Hono {
  const storage = new InMemoryStorage();
  const app = new Hono();

  async function runSync(): Promise<void> {
    if (storage.getSyncState().status === 'syncing') return;
    storage.setSyncing();
    try {
      await Promise.all(
        config.connectors.map(({ connector, config: connectorConfig }) =>
          connector.sync({
            config: connectorConfig,
            storage: storage.getStorageHandle(connector.id),
          }),
        ),
      );
      storage.setSyncSuccess();
    } catch (err) {
      storage.setSyncError(err instanceof Error ? err.message : String(err));
    }
  }

  app.get('/widgets', (c) => {
    return c.json(storage.getAllWidgets());
  });

  app.get('/widgets/:id', (c) => {
    const id = c.req.param('id');
    const sep = id.lastIndexOf(':');
    if (sep === -1) {
      return c.json({ error: 'Widget not found' }, 404);
    }
    const widget = storage.getWidget(id.slice(0, sep), id.slice(sep + 1));
    if (!widget) {
      return c.json({ error: 'Widget not found' }, 404);
    }
    return c.json(widget);
  });

  app.post('/sync', async (c) => {
    if (storage.getSyncState().status === 'syncing') {
      return c.json({ triggered: false });
    }
    void runSync();
    return c.json({ triggered: true });
  });

  app.get('/health', (c) => {
    return c.json(storage.getSyncState());
  });

  return app;
}
