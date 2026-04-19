import type { DashboardConfig } from '@rawdash/core';
import type { Hono } from 'hono';

import type { RawdashRouter } from '../router';
import type { InMemoryStorage } from '../storage';

export class SyncRouter implements RawdashRouter {
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
    const errors: string[] = [];
    await Promise.allSettled(
      this.config.connectors.map(async ({ connector }) => {
        const resources = this.getResourcesForConnector(connector.id);
        const handle = this.storage.getStorageHandle(connector.id);
        for (const resource of resources) {
          try {
            await connector.sync({ resource, mode: 'full' }, handle);
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
      }),
    );
    if (errors.length > 0) {
      this.storage.setSyncError(errors.join('; '));
    } else {
      this.storage.setSyncSuccess();
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
