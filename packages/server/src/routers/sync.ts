import type { DashboardConfig } from '@rawdash/core';
import type { Hono } from 'hono';

import type { RawdashRouter } from '../router';
import type { ServerStorage } from '../types';

const FULL_SYNC_TIMEOUT_MS = 300_000;

export class SyncRouter implements RawdashRouter {
  constructor(
    private config: DashboardConfig,
    private storage: ServerStorage,
  ) {}

  async runSync(): Promise<void> {
    const acquired = await this.storage.setSyncing();
    if (!acquired) {
      return;
    }
    const errors: string[] = [];
    await Promise.allSettled(
      this.config.connectors.map(async ({ connector }) => {
        const handle = this.storage.getStorageHandle(connector.id);
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          FULL_SYNC_TIMEOUT_MS,
        );
        try {
          await connector.sync({ mode: 'full' }, handle, controller.signal);
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            errors.push(
              `${connector.id} timed out after ${FULL_SYNC_TIMEOUT_MS}ms`,
            );
          } else {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    if (errors.length > 0) {
      await this.storage.setSyncError(errors.join('; '));
    } else {
      await this.storage.setSyncSuccess();
    }
  }

  mount(app: Hono): void {
    app.post('/sync', async (c) => {
      const state = await this.storage.getSyncState();
      if (state.status === 'syncing') {
        return c.json({ triggered: false });
      }
      void this.runSync();
      return c.json({ triggered: true });
    });
  }
}
