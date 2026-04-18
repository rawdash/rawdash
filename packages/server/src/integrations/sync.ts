import type { DashboardConfig } from '@rawdash/core';
import type { Hono } from 'hono';

import type { RawdashIntegration } from '../integration';
import type { InMemoryStorage } from '../storage';

export class SyncIntegration implements RawdashIntegration {
  constructor(
    private config: DashboardConfig,
    private storage: InMemoryStorage,
  ) {}

  private getResourcesForConnector(connectorId: string): Set<string> {
    const resources = new Set<string>();
    for (const widget of Object.values(this.config.widgets)) {
      if (widget.metric.connectorId === connectorId) {
        resources.add(widget.metric.resource);
      }
    }
    return resources;
  }

  async runSync(): Promise<void> {
    if (this.storage.getSyncState().status === 'syncing') {
      return;
    }
    this.storage.setSyncing();
    try {
      await Promise.all(
        this.config.connectors.map(async ({ connector }) => {
          const resources = this.getResourcesForConnector(connector.id);
          const handle = this.storage.getStorageHandle(connector.id);
          for (const resource of resources) {
            await connector.sync({ resource, mode: 'full' }, handle);
          }
        }),
      );
      this.storage.setSyncSuccess();
    } catch (err) {
      this.storage.setSyncError(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  mount(app: Hono): void {
    app.post('/sync', async (c) => {
      if (this.storage.getSyncState().status === 'syncing') {
        return c.json({ triggered: false });
      }
      void this.runSync();
      return c.json({ triggered: true });
    });
  }
}
