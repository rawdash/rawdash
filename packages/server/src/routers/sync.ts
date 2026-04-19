import type { DashboardConfig } from '@rawdash/core';
import type { Hono } from 'hono';

import type { RawdashRouter } from '../router';
import type { ServerStorage } from '../types';

const SYNC_TIMEOUT_MS = 30_000;

export class SyncRouter implements RawdashRouter {
  constructor(
    private config: DashboardConfig,
    private storage: ServerStorage,
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

  private async withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`${label} timed out after ${SYNC_TIMEOUT_MS}ms`)),
        SYNC_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  async runSync(): Promise<void> {
    if (this.storage.getSyncState().status === 'syncing') {
      return;
    }
    this.storage.setSyncing();
    const errors: string[] = [];
    const results = await Promise.allSettled(
      this.config.connectors.map(async ({ connector }) => {
        const resources = this.getResourcesForConnector(connector.id);
        const handle = this.storage.getStorageHandle(connector.id);
        for (const resource of resources) {
          try {
            await this.withTimeout(
              connector.sync({ resource, mode: 'full' }, handle),
              `${connector.id}/${resource}`,
            );
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        errors.push(
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        );
      }
    }
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
