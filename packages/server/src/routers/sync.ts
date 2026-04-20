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

  private async withTimeout<T>(
    promise: Promise<T>,
    label: string,
    timeoutMs: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs,
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
    const acquired = await this.storage.setSyncing();
    if (!acquired) {
      return;
    }
    const errors: string[] = [];
    const results = await Promise.allSettled(
      this.config.connectors.map(async ({ connector }) => {
        const handle = this.storage.getStorageHandle(connector.id);
        try {
          await this.withTimeout(
            connector.sync({ mode: 'full' }, handle),
            connector.id,
            FULL_SYNC_TIMEOUT_MS,
          );
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
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
