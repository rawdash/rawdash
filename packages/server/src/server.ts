import type { DashboardConfig } from '@rawdash/core';
import { Hono } from 'hono';

import { computeMetric } from './compute';
import { InMemoryStorage } from './storage';
import type { WidgetEntry } from './types';

export function createServer(config: DashboardConfig): Hono {
  const storage = new InMemoryStorage();
  const app = new Hono();

  function getResourcesForConnector(connectorId: string): Set<string> {
    const resources = new Set<string>();
    for (const widget of Object.values(config.widgets)) {
      if (widget.metric.connectorId === connectorId) {
        resources.add(widget.metric.resource);
      }
    }
    return resources;
  }

  async function runSync(): Promise<void> {
    if (storage.getSyncState().status === 'syncing') {
      return;
    }
    storage.setSyncing();
    try {
      await Promise.all(
        config.connectors.map(async ({ connector }) => {
          const resources = getResourcesForConnector(connector.id);
          const handle = storage.getStorageHandle(connector.id);
          for (const resource of resources) {
            await connector.sync({ resource, mode: 'full' }, handle);
          }
        }),
      );
      storage.setSyncSuccess();
    } catch (err) {
      storage.setSyncError(err instanceof Error ? err.message : String(err));
    }
  }

  function resolveWidget(input: string): WidgetEntry | undefined {
    const sep = input.lastIndexOf(':');
    const configKey = sep === -1 ? input : input.slice(sep + 1);
    const widget = config.widgets[configKey];
    if (!widget) {
      return undefined;
    }
    const { connectorId, resource } = widget.metric;
    const connectorEntry = config.connectors.find(
      (e) => e.connector.id === connectorId,
    );
    if (!connectorEntry) {
      return undefined;
    }
    const fields = connectorEntry.connector.resources[resource]?.fields;
    if (!fields) {
      return undefined;
    }
    const records = storage.getRecords(connectorId, resource);
    const data = computeMetric(records, widget.metric, fields);
    return {
      id: configKey,
      widgetId: input,
      connectorId,
      data,
      cachedAt: storage.getSyncState().lastSyncAt ?? new Date().toISOString(),
    };
  }

  app.get('/widgets', (c) => {
    const widgets = Object.keys(config.widgets)
      .map(resolveWidget)
      .filter((w): w is WidgetEntry => w !== undefined);
    return c.json(widgets);
  });

  app.get('/widgets/:id', (c) => {
    const widget = resolveWidget(c.req.param('id'));
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
